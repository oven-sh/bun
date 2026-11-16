const EventEmitter = require("node:events");
const compiled = require("internal/desktop/electron/compiled");
const { carryPorts, unwrapPorts, wrapPorts } = require("internal/desktop/electron/ipc");

const MARKER = "BUN_DESKTOP_UTILITY_PROCESS";
const running = new Map<UtilityProcess, { serviceName: string; creationTime: number }>();

class UtilityProcess extends EventEmitter {
  #child;
  #channel;
  #spawned = false;

  constructor(modulePath: string, args: string[] = [], options: any = {}) {
    super();
    if (!modulePath) throw new Error("Missing UtilityProcess entry script.");
    const { app, Event } = require("internal/desktop/app");
    if (!app.isReady()) throw new Error("utilityProcess cannot be created before app is ready.");
    const { stdio = "inherit", serviceName = "Node Utility Process" } = options;
    const [input, ...outputs] = $isArray(stdio) ? stdio : ["ignore", stdio, stdio];
    if (input !== "ignore") throw new Error("stdin value other than ignore is not supported.");
    // The entry point of an executable loads this module first, and then only goes on in the main process.
    const inExecutable = compiled.pathOf(Bun.pathToFileURL(modulePath).href);
    const { resourcesPath } = process as any;
    const about = { serviceName, resourcesPath, userAgent: app.userAgentFallback, inExecutable };
    const child = (this.#child = require("node:child_process").spawn(
      process.execPath,
      inExecutable
        ? [modulePath, ...args]
        : ["--preload=bun:desktop/electron", "--no-env-file", ...(options.execArgv ?? []), modulePath, ...args],
      {
        cwd: options.cwd,
        env: {
          ...(options.env ?? process.env),
          BUN_BE_BUN: inExecutable ? undefined : "1",
          [MARKER]: JSON.stringify(about),
        },
        stdio: [input, ...outputs, "ipc"],
        serialization: "advanced",
        windowsHide: true,
      },
    ));
    this.#channel = carryPorts(
      packet => child.connected && child.send(packet),
      0,
      data => this.emit("message", data),
    );
    child.on("message", this.#channel.accept);
    child.once("spawn", () => {
      this.#spawned = true;
      running.$set(this, { serviceName, creationTime: Date.now() });
      this.emit("spawn");
    });
    const exited = (code: number | null, signal?: string) => {
      const exitCode = code ?? require("node:os").constants.signals[signal!];
      this.#spawned = false;
      running.$delete(this);
      this.#channel.close();
      this.emit("exit", exitCode);
      if (exitCode === 0) return;
      const reason = code !== null ? "abnormal-exit" : /^SIG(?:TERM|KILL|INT)$/.test(signal!) ? "killed" : "crashed";
      const details = { type: "Utility", reason, exitCode, serviceName: "node.mojom.NodeService", name: serviceName };
      app.emit("child-process-gone", new Event(), details);
    };
    child.once("exit", exited);
    child.on("error", () => child.pid === undefined && exited(1));
  }

  get pid() {
    return this.#spawned ? this.#child.pid : undefined;
  }

  get stdout() {
    return this.#child.stdout;
  }

  get stderr() {
    return this.#child.stderr;
  }

  postMessage(message: unknown, transfer?: unknown[]) {
    this.#channel.post(message, unwrapPorts(transfer));
  }

  kill() {
    return this.#child.kill();
  }
}

class ParentPort extends EventEmitter {
  #channel;
  #queue: object[] | undefined = [];

  constructor(send: (packet: unknown) => void) {
    super();
    this.#channel = carryPorts(send, 1, (data, ports) => {
      const event = { data, ports: wrapPorts(ports) };
      if (this.#queue) this.#queue.push(event);
      else this.emit("message", event);
    });
    process.on("message", this.#channel.accept);
    this.on("newListener", (name: string) => name === "message" && this.start());
  }

  start() {
    setImmediate(() => {
      const queue = this.#queue ?? [];
      this.#queue = undefined;
      for (const event of queue) this.emit("message", event);
    });
  }

  pause() {
    this.#queue ??= [];
  }

  postMessage(message: unknown) {
    this.#channel.post(message, []);
  }
}

/** The `electron` module of a utility process, if this is one. */
function enter() {
  const about = process.env[MARKER];
  if (about === undefined) return;
  delete process.env[MARKER];
  delete process.env.BUN_BE_BUN;
  const { serviceName, resourcesPath, userAgent, inExecutable } = JSON.parse(about);
  const parentPort = new ParentPort(process.send!.bind(process));
  process.send = undefined;
  process.once("disconnect", () => process.exit());
  process.title = serviceName;
  Object.assign(process, { type: "utility", parentPort, resourcesPath });
  if (inExecutable) {
    process.argv.splice(1, 1);
    queueMicrotask(() => compiled.run(inExecutable, true));
  }
  const nativeFetch = fetch;
  return {
    parentPort,
    net: {
      fetch(input: any, init?: any) {
        const request = new Request(input, init);
        if (!request.headers.has("user-agent")) request.headers.set("user-agent", userAgent);
        return nativeFetch(request);
      },
      request: require("internal/desktop/electron/stubs").unsupported.throws("net.request in a utility process"),
      isOnline: () => true,
      online: true,
    },
  };
}

export default {
  enter,
  running,
  utilityProcess: {
    fork: (modulePath: string, args?: any, options?: any) => {
      if (args && !$isArray(args)) [args, options] = [[], args];
      return new UtilityProcess(modulePath, args, options);
    },
  },
};
