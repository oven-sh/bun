// Worker-side bootstrap of a node:worker_threads Worker. Run natively
// (Bun__NodeWorker__bootstrap) on the worker thread before preloads and the
// entry point, so everything a node worker must have without ever requiring
// node:worker_threads is wired here: parentPort delivery, the
// postMessageToThread control port, port-backed process stdio and console, and
// the worker variants of process methods.
//
// This runs on every node worker's startup path: it must not require the
// stream/events/util stacks. Anything heavy is installed lazily.
//
// node:worker_threads (either thread) reads the binding and the unwrapped
// workerData/parentPort from here, so the native binding is created once.

const BUN_WORKER_STDIO_KEY = "@@bunWorkerThreadsStdio";
const BUN_WORKER_MESSAGING_KEY = "@@bunWorkerThreadsMessaging";
// The worker's `parentPort`: port2 of a channel whose port1 is the parent
// Worker's public port (node's kPublicPort). Rides inside workerData like the
// stdio and control ports.
const BUN_WORKER_PARENT_PORT_KEY = "@@bunWorkerThreadsParentPort";

const binding = $cpp("Worker.cpp", "createNodeWorkerThreadsBinding") as unknown[];
const setEntryEvaluatedHook = binding[9] as (hook: () => void) => void;
const isNodeWorker = binding[10] as boolean;
const setParentPort = binding[11] as (port: MessagePort) => void;
const setStdioPorts = binding[12] as (ports: object) => void;

const isMainThread = Bun.isMainThread;

let workerData = binding[0] as any;
let parentPort: MessagePort | null = null;

// Gate on isNodeWorker so a raw `new globalThis.Worker` whose workerData happens
// to carry one of these keys does not get its stdio rebound / workerData unwrapped.
if (
  !isMainThread &&
  isNodeWorker &&
  workerData &&
  typeof workerData === "object" &&
  (BUN_WORKER_STDIO_KEY in workerData ||
    BUN_WORKER_MESSAGING_KEY in workerData ||
    BUN_WORKER_PARENT_PORT_KEY in workerData)
) {
  const stdioPorts = workerData[BUN_WORKER_STDIO_KEY];
  const controlPort = workerData[BUN_WORKER_MESSAGING_KEY];
  const transferredParentPort = workerData[BUN_WORKER_PARENT_PORT_KEY];
  workerData = workerData.data;
  if (stdioPorts) {
    // process.stdin/stdout/stderr are native lazy properties; with the ports
    // registered they materialize as port-backed streams on first access.
    setStdioPorts(stdioPorts);
    installLazyConsole();
  }
  if (controlPort) require("internal/worker/messaging").setupMainThreadPort(controlPort, setEntryEvaluatedHook);
  // A real MessagePort entangled with the parent Worker's public port: adding a
  // 'message' listener starts it and keeps this thread alive; close()/unref()/
  // removing the listeners let the thread exit — node's parentPort lifecycle.
  if (transferredParentPort) {
    parentPort = transferredParentPort;
    // node auto-starts parentPort, but delivery waits until the entry module has
    // evaluated (registering it natively is how start() knows to defer). Only
    // parentPort receives what the parent posts: `self.onmessage` on the global
    // scope is not a channel in a node worker, as in node. The port arrives
    // without a loop ref, so an unlistened parentPort does not by itself keep
    // the thread alive (a 'message' listener refs it, as in node).
    setParentPort(parentPort);
    parentPort.start();
  }
}

// In a node:worker_threads worker, several process operations are unsupported.
// Same isNodeWorker gate: a raw `new globalThis.Worker` keeps the full process.
if (!isMainThread && isNodeWorker) {
  applyWorkerProcessOverrides();
}

// node routes a worker's console through its process.stdout/stderr (so the
// parent's worker.stdout captures it). Building that Console pulls in node:util;
// defer it, and the port streams under it, to the first console access.
function installLazyConsole() {
  const nativeConsole = globalThis.console;
  let console: unknown;
  let constructing = false;
  Object.defineProperty(globalThis, "console", {
    configurable: true,
    enumerable: false,
    get() {
      // Re-entrant while building (node:console / node:util read the global).
      if (constructing) return nativeConsole;
      if (console === undefined) {
        constructing = true;
        try {
          console = new nativeConsole.Console(process.stdout, process.stderr);
        } finally {
          constructing = false;
        }
      }
      Object.defineProperty(globalThis, "console", { value: console, writable: true, configurable: true });
      return console;
    },
    set(value) {
      Object.defineProperty(globalThis, "console", { value, writable: true, configurable: true });
    },
  });
}

function applyWorkerProcessOverrides() {
  const proc: any = process;
  // node defaults debugPort to 9229 in workers (still settable). Per-object property:
  // the static accessor's setter writes a process-global shared across threads.
  try {
    Object.defineProperty(proc, "debugPort", { value: 9229, writable: true, configurable: true, enumerable: true });
  } catch {}
  // process.umask(setMask) is unsupported in workers; the getter still works.
  const realUmask = proc.umask;
  function umask(mask?: unknown) {
    if (mask === undefined) return realUmask.$call(proc);
    throw $ERR_WORKER_UNSUPPORTED_OPERATION("Setting process.umask() is not supported in workers");
  }
  proc.umask = umask;
  // Disabled, throwing stubs (each carries `.disabled === true`, like node).
  const disabled = ["abort", "chdir"];
  if (process.platform !== "win32") {
    disabled.push("setuid", "seteuid", "setgid", "setegid", "setgroups", "initgroups");
  }
  // node only disables send/disconnect/channel/connected in workers that inherited an
  // IPC channel (NODE_CHANNEL_FD); otherwise they stay absent so `if (process.send)` works.
  const hasIpc = !!process.env.NODE_CHANNEL_FD;
  if (hasIpc) {
    disabled.push("send", "disconnect");
  }
  for (const name of disabled) {
    const stub: any = function () {
      throw $ERR_WORKER_UNSUPPORTED_OPERATION(`process.${name}() is not supported in workers`);
    };
    stub.disabled = true;
    Object.defineProperty(proc, name, { configurable: true, writable: true, enumerable: true, value: stub });
  }
  // IPC accessors throw on access only in a worker that inherited an IPC channel.
  if (hasIpc) {
    for (const name of ["channel", "connected"]) {
      Object.defineProperty(proc, name, {
        configurable: true,
        enumerable: false,
        get() {
          throw $ERR_WORKER_UNSUPPORTED_OPERATION(`process.${name} is not supported in workers`);
        },
      });
    }
  }
}

export default {
  binding,
  workerData,
  parentPort,
  BUN_WORKER_STDIO_KEY,
  BUN_WORKER_MESSAGING_KEY,
  BUN_WORKER_PARENT_PORT_KEY,
};
