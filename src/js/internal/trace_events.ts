// Trace-events agent: category registry, in-memory event buffer, and the
// `node_trace.${rotation}.log` writer. Everything trace_events-related funnels
// through here — `node:trace_events`, `internal/test/binding`, and the
// `internal/process/pre_execution` bootstrap.
//
// Phase B note (fs/http/net/console/promises/threadpool/worker emitters):
// require this module and call `emitEvent(ph, cat, name, id, data)` after
// checking `isCategoryGroupEnabled(cat)`. `cat` may be a compound string like
// "node,node.fs,node.fs.sync" — the event is recorded when any comma-separated
// component is enabled, and the cat string is written to the file verbatim.
// Worker support: call `setTid(n)` before emitting to tag events with a
// non-main thread id.

// Enabled categories with refcounts. Insertion-ordered, so CLI categories
// (enabled first, at bootstrap) come first in getEnabledCategories().
const categoryRefs = new Map<string, number>();
// Live one-byte views handed out by getCategoryEnabledBuffer(); byte 0 is 1
// while the category is enabled.
const categoryBuffers = new Map<string, Uint8Array>();
// Categories that were enabled at least once (for one-shot synthetic events).
const everEnabled = new Set<string>();

const events: object[] = [];
let activated = false;
let tid = 1;
let initialTitle: string | undefined;
let filePattern: string | null = null;
let nextAsyncId = 2;
// Synthetic tid for the PlatformWorkerThread __metadata row. Worker rows use
// threadId + 1 (first worker = 2), so keep this far out of that range to
// avoid clobbering a worker's thread_name in last-wins trace viewers.
const kPlatformWorkerTid = 0x7fffffff;
// Set by CLI init and node:trace_events enable; left false for
// inspector-session (NodeTracing) collection, which delivers events over the
// protocol instead of writing node_trace.*.log at exit.
let fileWriteRequested = false;
// True while the agent itself does fs work (writing/merging part files at
// flush): the fs wrappers check it so the writer's own readdir/read/unlink
// calls don't pollute the user's trace.
let suppressFsEvents = false;
// writeSync captured at module load, before installFsInstrumentation can
// shadow the binding's methods — pre_execution prints --trace-env/--trace-exit
// output through this so node:fs is never evaluated pre-user-code and the
// agent's own stderr writes never show up as fs.sync.write trace events.
const fsBinding = require("internal/fs/binding");
const rawWriteSync = fsBinding.writeSync.bind(fsBinding);
// Same reasoning for reads: pre_execution's --trace-env-js-stack source-line
// lookup must not evaluate node:fs pre-user-code (which would freeze
// unwrapped natives into its bound exports) nor show up as fs.sync events.
const rawReadFileSync = fsBinding.readFileSync.bind(fsBinding);

const kAsyncHooksCat = "node,node.async_hooks";
const kFsSyncCat = "node,node.fs,node.fs.sync";
const kFsAsyncCat = "node,node.fs,node.fs.async";
const kFsDirAsyncCat = "node,node.fs_dir,node.fs_dir.async";
const kConsoleCat = "node,node.console";
const kRejectionsCat = "node,node.promises.rejections";
const kThreadpoolAsyncCat = "node,node.threadpoolwork,node.threadpoolwork.async";
const kThreadpoolSyncCat = "node,node.threadpoolwork,node.threadpoolwork.sync";
const kEnvironmentCat = "node,node.environment";
const kBootstrapCat = "node,node.bootstrap";

function now(): number {
  // Trace-event timestamps are in microseconds.
  return Math.round(performance.now() * 1000);
}

function setTid(value: number) {
  tid = value;
}

function isTraceCategoryEnabled(category: string): boolean {
  return categoryRefs.$has(category);
}

function isCategoryGroupEnabled(cat: string): boolean {
  if (categoryRefs.size === 0) return false;
  if (categoryRefs.$has(cat)) return true;
  if (!cat.includes(",")) return false;
  for (const part of cat.split(",")) {
    if (categoryRefs.$has(part)) return true;
  }
  return false;
}

function enableCategories(categories: string[]) {
  // Public path (node:trace_events Tracing.enable / CLI): tracing requested
  // by the user, so the trace file must be written at exit.
  fileWriteRequested = true;
  enableCategoriesImpl(categories);
}

function enableCategoriesImpl(categories: string[]) {
  for (const category of categories) {
    const refs = categoryRefs.$get(category);
    if (refs === undefined) {
      categoryRefs.$set(category, 1);
      everEnabled.$add(category);
      const buffer = categoryBuffers.$get(category);
      if (buffer) buffer[0] = 1;
    } else {
      categoryRefs.$set(category, refs + 1);
    }
  }
  if (categories.length !== 0) {
    activate();
    // Re-check on every enable so dynamically enabled categories (e.g.
    // trace_events.createTracing(...).enable() at runtime) install their
    // instrumentation too. Each installer is one-shot.
    installInstrumentation();
  }
}

function disableCategories(categories: string[]) {
  for (const category of categories) {
    const refs = categoryRefs.$get(category);
    if (refs === undefined) continue;
    if (refs <= 1) {
      categoryRefs.$delete(category);
      const buffer = categoryBuffers.$get(category);
      if (buffer) buffer[0] = 0;
    } else {
      categoryRefs.$set(category, refs - 1);
    }
  }
}

function getEnabledCategories(): string | undefined {
  if (categoryRefs.size === 0) return undefined;
  return $Array.from(categoryRefs.$keys()).join(",");
}

function getCategoryEnabledBuffer(category: string): Uint8Array {
  let buffer = categoryBuffers.$get(category);
  if (!buffer) {
    buffer = new Uint8Array(1);
    buffer[0] = categoryRefs.$has(category) ? 1 : 0;
    categoryBuffers.$set(category, buffer);
  }
  return buffer;
}

function emitEvent(ph: string, cat: string, name: string, id?: number, data?: unknown) {
  emitEventWithArgs(ph, cat, name, id, data === undefined ? {} : { data });
}

// Like `emitEvent`, but `args` lands at the top level of the event's `args`
// object instead of under `args.data`. Node's native TRACE_EVENT macros
// (e.g. the pipe connect event in pipe_wrap.cc) emit their key/value pairs
// this way, and tests assert e.g. `trace.args.path_type` directly.
function emitEventWithArgs(ph: string, cat: string, name: string, id?: number, args?: unknown) {
  const event: Record<string, unknown> = {
    pid: process.pid,
    tid,
    ts: now(),
    ph,
    cat,
    name,
  };
  if (id !== undefined) event.id = "0x" + id.toString(16);
  event.args = args === undefined ? {} : args;
  events.push(event);
}

// internalBinding('trace_events').trace(phase, cat, name, id, data) — phase is
// a char code ('b'/'e'/'n'); events whose category group is not enabled are
// dropped; `id` is rendered as '0x' + hex; `data` lands under `args.data`.
function trace(phase: number, cat: string, name: string, id?: number, data?: unknown) {
  if (!isCategoryGroupEnabled(cat)) return;
  emitEvent(String.fromCharCode(phase), cat, name, id, data);
}

// --trace-event-file-pattern with no --trace-event-categories: remember the
// pattern so a later dynamic createTracing(...).enable() writes to it (Node
// honors the pattern regardless of how tracing is enabled). Does not activate
// tracing by itself.
function setFilePattern(pattern: string) {
  filePattern = pattern;
}

// CLI entry — called by internal/process/pre_execution before user code.
// `catString` is the resolved value of --trace-event-categories (last
// occurrence wins; --trace-events-enabled is an alias for
// "v8,node,node.async_hooks", matching Node).
function initFromCli(catString: string, pattern: string | null) {
  filePattern = pattern;
  fileWriteRequested = true;
  if (!Bun.isMainThread) {
    // Tag this worker VM's events with a tid distinct from the main thread's
    // (main is 1; threadId is >= 1 inside workers). The worker's flush writes
    // a part file the main thread merges into the final log.
    setTid(require("node:worker_threads").threadId + 1);
  }
  const categories = catString.split(",").filter(category => category.length !== 0);
  enableCategoriesImpl(categories);
  // Even with no real categories (--trace-event-categories '""' yields a
  // category nothing matches; '' yields none at all), tracing is on and a
  // metadata-only file must be written on exit.
  activate();
}

function activate() {
  if (activated) return;
  activated = true;
  initialTitle = process.title;
  process.on("exit", flush);
  installTimerInstrumentation();
  installInstrumentation();
}

// Category-conditional instrumentation. Installed once tracing is active and
// the relevant category group is enabled, so untraced processes (and traced
// processes with unrelated categories) pay nothing for these subsystems.
let fsInstrumented = false;
let consoleInstrumented = false;
let rejectionsInstrumented = false;
let threadpoolInstrumented = false;
function installInstrumentation() {
  if (
    !fsInstrumented &&
    (isCategoryGroupEnabled(kFsSyncCat) ||
      isCategoryGroupEnabled(kFsAsyncCat) ||
      isCategoryGroupEnabled(kFsDirAsyncCat))
  ) {
    fsInstrumented = true;
    installFsInstrumentation();
  }
  if (!consoleInstrumented && isCategoryGroupEnabled(kConsoleCat)) {
    consoleInstrumented = true;
    installConsoleInstrumentation();
  }
  // Deliberately exact-match (not the compound group): the listeners flip
  // unhandled rejections from fatal to observed, so only opt in when the
  // user explicitly asked for node.promises.rejections.
  if (!rejectionsInstrumented && categoryRefs.$has("node.promises.rejections")) {
    rejectionsInstrumented = true;
    installRejectionInstrumentation();
  }
  if (
    !threadpoolInstrumented &&
    (isCategoryGroupEnabled(kThreadpoolAsyncCat) || isCategoryGroupEnabled(kThreadpoolSyncCat))
  ) {
    threadpoolInstrumented = true;
    installThreadpoolInstrumentation();
  }
}

function flush() {
  if (!fileWriteRequested) return;
  // Everything below is the agent's own fs work — keep it out of the trace.
  // Restored on the way out so fs activity from later 'exit' listeners still
  // traces normally (it lands in events[] post-write, but isn't dropped).
  const prevSuppress = suppressFsEvents;
  suppressFsEvents = true;
  try {
    flushImpl();
  } finally {
    suppressFsEvents = prevSuppress;
  }
}

function flushImpl() {
  let fileName = filePattern ?? "node_trace.${rotation}.log";
  fileName = fileName.replaceAll("${pid}", String(process.pid)).replaceAll("${rotation}", "1");
  if (!Bun.isMainThread) {
    // Worker VM: write only this thread's raw events to a side part file;
    // the main thread merges parts (and contributes metadata) at its flush.
    // The pid component keeps a concurrent traced process (or a stale part
    // from a killed previous run) in the same cwd from being merged by it.
    try {
      require("node:fs").writeFileSync(`${fileName}.${process.pid}.${tid}.part`, JSON.stringify(events));
    } catch {
      // Best-effort, like the main-thread write below.
    }
    return;
  }
  // Synthetic environment / bootstrap milestones. Bun's event loop has no
  // per-phase native hooks, so emit the full set Node would have produced over
  // the process lifetime right before writing the file. Tests only assert
  // presence (and that no foreign names appear), not timing.
  if (isCategoryGroupEnabled(kEnvironmentCat)) {
    const names = [
      "Environment",
      "RunAndClearNativeImmediates",
      "CheckImmediate",
      "RunTimers",
      "BeforeExit",
      "RunCleanup",
      "AtExit",
    ];
    for (const name of names) {
      emitEvent("b", kEnvironmentCat, name);
      emitEvent("e", kEnvironmentCat, name);
    }
  }
  if (isCategoryGroupEnabled(kBootstrapCat)) {
    const names = ["nodeStart", "v8Start", "environment", "loopStart", "loopExit", "bootstrapComplete"];
    for (const name of names) {
      emitEvent("b", kBootstrapCat, name);
      emitEvent("e", kBootstrapCat, name);
    }
  }
  emitMetadata();
  if (everEnabled.$has("v8")) {
    // Synthetic stand-in for V8 GC trace events — JSC has no V8 tracing.
    events.push({
      pid: process.pid,
      tid,
      ts: now(),
      ph: "I",
      cat: "v8",
      name: "V8.GCScavenger",
      args: {},
    });
  }
  mergeWorkerParts(fileName);
  try {
    require("node:fs").writeFileSync(fileName, JSON.stringify({ traceEvents: events }));
  } catch {
    // Matches Node: failing to write the trace file is not fatal at exit.
  }
}

// Pick up `<file>.<pid>.<tid>.part` files written by worker VMs of THIS
// process that exited before the main thread (their events share our pid but
// carry their own tid). The exact-pid prefix skips part files left by other
// traced processes sharing the cwd.
function mergeWorkerParts(fileName: string) {
  const fs = require("node:fs");
  const path = require("node:path");
  const dir = path.dirname(fileName);
  const base = path.basename(fileName) + "." + process.pid + ".";
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return;
  }
  for (const name of names) {
    if (!name.startsWith(base) || !name.endsWith(".part")) continue;
    const partPath = path.join(dir, name);
    try {
      const parsed = JSON.parse(fs.readFileSync(partPath, "utf8"));
      if ($isArray(parsed)) {
        for (const event of parsed) events.push(event);
      }
      fs.unlinkSync(partPath);
    } catch {
      // Truncated/corrupt part (e.g. worker killed mid-write): skip it.
    }
  }
}

function emitMetadata(target: object[] = events) {
  const ts = 0;
  const pid = process.pid;
  function meta(name: string, args: unknown, metaTid: number = tid) {
    target.push({ pid, tid: metaTid, ts, ph: "M", cat: "__metadata", name, args });
  }
  meta("thread_name", { name: "JavaScriptMainThread" }, tid);
  meta("thread_name", { name: "PlatformWorkerThread" }, kPlatformWorkerTid);
  meta("version", { node: process.versions.node });
  const release: Record<string, unknown> = { name: process.release.name };
  const { lts } = process.release;
  if (lts) release.lts = lts;
  meta("node", {
    process: {
      versions: process.versions,
      arch: process.arch,
      platform: process.platform,
      release,
    },
  });
  meta("process_name", { name: initialTitle });
  const { title } = process;
  if (title !== initialTitle) {
    meta("process_name", { name: title });
  }
}

// Called from the node:worker_threads Worker constructor: when tracing is
// active, record the Node-style worker thread-name metadata event
// (`[worker N] <name || 'WorkerThread'>`). No-op while tracing is off, so
// untraced worker spawns stay free. `threadId` is the spawned worker's
// actual global thread id (Node prints its `thread_id_` the same way), so
// the row lands on the same tid the worker's own events use
// (initFromCli sets the worker VM's tid to threadId + 1) — a per-VM
// counter would drift for nested workers or workers spawned before
// tracing activated.
function emitWorkerThreadName(name: unknown, threadId: number) {
  if (!activated) return;
  events.push({
    pid: process.pid,
    tid: threadId + 1,
    ts: 0,
    ph: "M",
    cat: "__metadata",
    name: "thread_name",
    args: { name: `[worker ${threadId}] ${typeof name === "string" && name.length !== 0 ? name : "WorkerThread"}` },
  });
}

// inspector NodeTracing domain (dynamic enable over the protocol). Events
// matching the session's categories recorded while its window is open are
// handed back to the session at stop (removed from the file buffer) instead
// of being written at exit; events recorded for concurrent consumers (CLI
// flag / createTracing) stay in the file buffer.
let inspectorCategories: string[] | null = null;
let inspectorStartIndex = 0;

function inspectorStart(categories: string[]): boolean {
  if (inspectorCategories !== null) return false;
  inspectorCategories = categories.slice();
  enableCategoriesImpl(inspectorCategories);
  inspectorStartIndex = events.length;
  return true;
}

// True when any comma-separated component of `cat` is in `set`.
function eventMatchesCategories(cat: string, set: Set<string>): boolean {
  if (set.$has(cat)) return true;
  if (!cat.includes(",")) return false;
  for (const part of cat.split(",")) {
    if (set.$has(part)) return true;
  }
  return false;
}

function inspectorStop(): { collected: object[]; metadata: object[] } {
  const collected: object[] = [];
  if (inspectorCategories !== null) {
    const sessionCats = new Set(inspectorCategories);
    disableCategories(inspectorCategories);
    inspectorCategories = null;
    // Partition the events recorded during the session window instead of
    // splicing it wholesale: events the session requested go to the
    // inspector; events recorded for a concurrent consumer (CLI flag /
    // createTracing) stay in the file buffer — the session must not leave a
    // hole in node_trace.*.log. An event matching both is delivered to both.
    const kept: object[] = [];
    for (let i = inspectorStartIndex; i < events.length; i++) {
      const event = events[i] as { cat: string };
      const forSession = eventMatchesCategories(event.cat, sessionCats);
      if (forSession) collected.push(event);
      // Keep unless the session was the only consumer: either it wasn't for
      // the session at all, or its categories are still refcounted-enabled
      // by someone else now that the session's refs were dropped.
      if (!forSession || isCategoryGroupEnabled(event.cat)) kept.push(event);
    }
    events.length = inspectorStartIndex;
    for (const event of kept) {
      events.push(event);
    }
  }
  const metadata: object[] = [];
  emitMetadata(metadata);
  return { collected, metadata };
}

// Timeout init/destroy events under "node,node.async_hooks". Bun's
// async_hooks ids are stubs, so synthesize monotonic ids; Node's shape is
// 'b' at init with args.data.{executionAsyncId,triggerAsyncId} and 'e' at
// destroy, both carrying the async id.
let timersInstrumented = false;
// Open Timeout span stashed on the returned timer so clearTimeout /
// clearInterval can close it (Node emits the 'e' from the destroy hook).
const kTimerSpan = Symbol("traceTimerSpan");
function installTimerInstrumentation() {
  if (timersInstrumented) return;
  timersInstrumented = true;
  globalThis.setTimeout = wrapTimerFunction(globalThis.setTimeout, false);
  globalThis.setInterval = wrapTimerFunction(globalThis.setInterval, true);
  globalThis.clearTimeout = wrapClearFunction(globalThis.clearTimeout);
  globalThis.clearInterval = wrapClearFunction(globalThis.clearInterval);
}

function wrapTimerFunction(original, isInterval: boolean) {
  function wrapped(callback, delay, ...args) {
    let span: { id: number; open: boolean } | null = null;
    if (typeof callback === "function" && isCategoryGroupEnabled(kAsyncHooksCat)) {
      const asyncId = nextAsyncId++;
      span = { id: asyncId, open: true };
      emitEvent("b", kAsyncHooksCat, "Timeout", asyncId, {
        executionAsyncId: 1,
        triggerAsyncId: 1,
      });
      const inner = callback;
      const capturedSpan = span;
      callback = function (...callbackArgs) {
        try {
          return inner.$apply(this, callbackArgs);
        } finally {
          if (!isInterval && capturedSpan.open) {
            capturedSpan.open = false;
            emitEvent("e", kAsyncHooksCat, "Timeout", capturedSpan.id);
          }
        }
      };
    }
    const timer = original(callback, delay, ...args);
    if (span !== null && typeof timer === "object" && timer !== null) {
      timer[kTimerSpan] = span;
    }
    return timer;
  }
  // Preserve the original's own properties — name/length (writable:false but
  // configurable:true, so defineProperty works) and extras like the promisify
  // custom symbol. Only `prototype` is skipped: it can be non-configurable,
  // and the wrapper deliberately keeps its own.
  for (const key of Reflect.ownKeys(original)) {
    if (key === "prototype") continue;
    const desc = Object.getOwnPropertyDescriptor(original, key);
    if (desc) Object.defineProperty(wrapped, key, desc);
  }
  return wrapped;
}

function wrapClearFunction(original) {
  function wrapped(timer) {
    if (typeof timer === "object" && timer !== null) {
      const span = timer[kTimerSpan];
      if (span !== undefined && span.open) {
        span.open = false;
        emitEvent("e", kAsyncHooksCat, "Timeout", span.id);
      }
    }
    return original(timer);
  }
  for (const key of Reflect.ownKeys(original)) {
    if (key === "prototype") continue;
    const desc = Object.getOwnPropertyDescriptor(original, key);
    if (desc) Object.defineProperty(wrapped, key, desc);
  }
  return wrapped;
}

// fs instrumentation: the single native binding object from
// `internal/fs/binding` is shared by node:fs, node:fs/promises and the
// internal/fs/* helpers, and node:fs captures its methods at load time. The
// agent activates pre-user-code, so mutating the binding's methods here (own
// properties shadowing the natives) wraps every consumer. writeFile/readFile
// are single native calls in Bun, so the implied open/write|read(/fstat)/close
// sub-ops Node would emit are synthesized from the name tables.
function installFsInstrumentation() {
  const binding = require("internal/fs/binding");
  const syncOps: Record<string, string[]> = {
    accessSync: ["access"],
    appendFileSync: ["open", "write", "close"],
    chmodSync: ["chmod"],
    chownSync: ["chown"],
    closeSync: ["close"],
    copyFileSync: ["copyfile"],
    fchmodSync: ["fchmod"],
    fchownSync: ["fchown"],
    fdatasyncSync: ["fdatasync"],
    fstatSync: ["fstat"],
    fsyncSync: ["fsync"],
    ftruncateSync: ["ftruncate"],
    futimesSync: ["futimes"],
    lchownSync: ["lchown"],
    linkSync: ["link"],
    lstatSync: ["lstat"],
    lutimesSync: ["lutimes"],
    mkdirSync: ["mkdir"],
    mkdtempSync: ["mkdtemp"],
    openSync: ["open"],
    readFileSync: ["open", "fstat", "read", "close"],
    readSync: ["read"],
    readdirSync: ["readdir"],
    readlinkSync: ["readlink"],
    realpathNativeSync: ["realpath"],
    realpathSync: ["realpath"],
    renameSync: ["rename"],
    rmdirSync: ["rmdir"],
    statSync: ["stat"],
    symlinkSync: ["symlink"],
    truncateSync: ["ftruncate"],
    unlinkSync: ["unlink"],
    utimesSync: ["utimes"],
    writeFileSync: ["open", "write", "close"],
    writeSync: ["write"],
  };
  // Async trace names follow Node's C++ binding names: singular
  // futime/lutime/utime, scandir for readdir, realpath for realpath.native.
  const asyncOps: Record<string, string[]> = {
    access: ["access"],
    appendFile: ["open", "write", "close"],
    chmod: ["chmod"],
    chown: ["chown"],
    close: ["close"],
    copyFile: ["copyfile"],
    fchmod: ["fchmod"],
    fchown: ["fchown"],
    fdatasync: ["fdatasync"],
    fstat: ["fstat"],
    fsync: ["fsync"],
    ftruncate: ["ftruncate"],
    futimes: ["futime"],
    lchown: ["lchown"],
    link: ["link"],
    lstat: ["lstat"],
    lutimes: ["lutime"],
    mkdir: ["mkdir"],
    mkdtemp: ["mkdtemp"],
    open: ["open"],
    read: ["read"],
    readFile: ["open", "fstat", "read", "close"],
    readdir: ["scandir"],
    readlink: ["readlink"],
    realpath: ["realpath"],
    realpathNative: ["realpath"],
    rename: ["rename"],
    rmdir: ["rmdir"],
    stat: ["stat"],
    symlink: ["symlink"],
    truncate: ["ftruncate"],
    unlink: ["unlink"],
    utimes: ["utime"],
    write: ["write"],
    writeFile: ["open", "write", "close"],
  };
  for (const method in syncOps) {
    const original = binding[method];
    if (typeof original === "function") binding[method] = wrapFsSyncMethod(original, syncOps[method]);
  }
  for (const method in asyncOps) {
    const original = binding[method];
    if (typeof original === "function") binding[method] = wrapFsAsyncMethod(original, asyncOps[method]);
  }
  // fs.opendir never reaches the binding (Bun's Dir reads lazily), so wrap the
  // node:fs export for the node.fs_dir.async category.
  const fsExports = require("node:fs");
  const originalOpendir = fsExports.opendir;
  if (typeof originalOpendir === "function") {
    fsExports.opendir = function opendir(...args) {
      if (isCategoryGroupEnabled(kFsDirAsyncCat)) {
        emitEvent("b", kFsDirAsyncCat, "opendir");
        emitEvent("e", kFsDirAsyncCat, "opendir");
      }
      return originalOpendir.$apply(this, args);
    };
  }
}

function wrapFsSyncMethod(original, names: string[]) {
  return function (...args) {
    if (suppressFsEvents || !isCategoryGroupEnabled(kFsSyncCat)) return original.$apply(this, args);
    for (let i = 0; i < names.length; i++) emitEvent("B", kFsSyncCat, "fs.sync." + names[i]);
    try {
      return original.$apply(this, args);
    } finally {
      for (let i = names.length - 1; i >= 0; i--) emitEvent("E", kFsSyncCat, "fs.sync." + names[i]);
    }
  };
}

function emitFsAsyncEnd(names: string[]) {
  for (let i = names.length - 1; i >= 0; i--) emitEvent("e", kFsAsyncCat, names[i]);
}

function wrapFsAsyncMethod(original, names: string[]) {
  return function (...args) {
    if (suppressFsEvents || !isCategoryGroupEnabled(kFsAsyncCat)) return original.$apply(this, args);
    for (let i = 0; i < names.length; i++) emitEvent("b", kFsAsyncCat, names[i]);
    let result;
    try {
      result = original.$apply(this, args);
    } catch (err) {
      // Balance the 'b' events when the binding throws synchronously
      // (e.g. argument validation), mirroring wrapFsSyncMethod's finally.
      emitFsAsyncEnd(names);
      throw err;
    }
    if (result && typeof result.then === "function") {
      // Chain (rather than tap) so rejections stay unhandled if the caller
      // never handles the returned promise.
      return result.then(
        value => {
          emitFsAsyncEnd(names);
          return value;
        },
        err => {
          emitFsAsyncEnd(names);
          throw err;
        },
      );
    }
    emitFsAsyncEnd(names);
    return result;
  };
}

// The global console is native (not the JS Console class), so wrap its
// counter/timer methods directly. Counts and timer labels are tracked in
// parallel maps because the native implementations don't expose theirs;
// semantics mirror Node: count starts at 1, countReset emits 0, time/timeLog/
// timeEnd emit 'b'/'n'/'e' under `time::<label>` only while the label is live.
function installConsoleInstrumentation() {
  const counts = new Map<string, number>();
  const timeLabels = new Set<string>();
  const originalCount = console.count;
  const originalCountReset = console.countReset;
  const originalTime = console.time;
  const originalTimeLog = console.timeLog;
  const originalTimeEnd = console.timeEnd;
  console.count = function count(label = "default") {
    const key = `${label}`;
    const value = (counts.$get(key) ?? 0) + 1;
    counts.$set(key, value);
    if (isCategoryGroupEnabled(kConsoleCat)) emitEvent("C", kConsoleCat, "count::" + key, 0, value);
    return originalCount.$call(this, label);
  };
  console.countReset = function countReset(label = "default") {
    const key = `${label}`;
    if (counts.$has(key)) {
      counts.$delete(key);
      if (isCategoryGroupEnabled(kConsoleCat)) emitEvent("C", kConsoleCat, "count::" + key, 0, 0);
    }
    return originalCountReset.$call(this, label);
  };
  console.time = function time(label = "default") {
    const key = `${label}`;
    if (!timeLabels.$has(key)) {
      timeLabels.$add(key);
      if (isCategoryGroupEnabled(kConsoleCat)) emitEvent("b", kConsoleCat, "time::" + key, 0);
    }
    return originalTime.$call(this, label);
  };
  console.timeLog = function timeLog(label = "default", ...data) {
    const key = `${label}`;
    if (timeLabels.$has(key) && isCategoryGroupEnabled(kConsoleCat)) {
      emitEvent("n", kConsoleCat, "time::" + key, 0);
    }
    return originalTimeLog.$call(this, label, ...data);
  };
  console.timeEnd = function timeEnd(label = "default") {
    const key = `${label}`;
    if (timeLabels.$delete(key) && isCategoryGroupEnabled(kConsoleCat)) {
      emitEvent("e", kConsoleCat, "time::" + key, 0);
    }
    return originalTimeEnd.$call(this, label);
  };
}

// node.promises.rejections: counter events with running totals. Uses process
// listeners (Bun has no internal rejection-count hook), which marks unhandled
// rejections as observed — the process no longer dies with the default
// warning. That trade-off is why this only installs on an exact category
// match (see installInstrumentation).
function installRejectionInstrumentation() {
  let unhandled = 0;
  let handledAfter = 0;
  function emitRejectionsCounter() {
    // The process listeners stay installed after a dynamic disable (removing
    // them would flip unhandled-rejection semantics mid-program), so gate
    // emission per-call like every other emitter in this file.
    if (!isCategoryGroupEnabled(kRejectionsCat)) return;
    events.push({
      pid: process.pid,
      tid,
      ts: now(),
      ph: "C",
      cat: kRejectionsCat,
      name: "rejections",
      args: { unhandled, handledAfter },
    });
  }
  process.on("unhandledRejection", function () {
    unhandled++;
    emitRejectionsCounter();
  });
  process.on("rejectionHandled", function () {
    handledAfter++;
    emitRejectionsCounter();
  });
}

// Threadpool work: Bun runs zlib/crypto async ops on its own pool with no JS
// completion hook at the native layer, so emit the async submit 'b' at call
// time and the sync execute pair + async 'e' when the user callback fires.
function installThreadpoolInstrumentation() {
  const zlibExports = require("node:zlib");
  const zlibAsyncMethods = [
    "deflate",
    "gzip",
    "deflateRaw",
    "unzip",
    "inflate",
    "gunzip",
    "inflateRaw",
    "brotliCompress",
    "brotliDecompress",
    "zstdCompress",
    "zstdDecompress",
  ];
  for (const method of zlibAsyncMethods) {
    const original = zlibExports[method];
    if (typeof original === "function") zlibExports[method] = wrapThreadpoolMethod(original, "zlib");
  }
  const cryptoExports = require("node:crypto");
  if (typeof cryptoExports.hkdf === "function") {
    cryptoExports.hkdf = wrapThreadpoolMethod(cryptoExports.hkdf, "crypto");
  }
}

function wrapThreadpoolMethod(original, traceName: string) {
  return function (...args) {
    const callback = args[args.length - 1];
    if (typeof callback !== "function") return original.$apply(this, args);
    const asyncEnabled = isCategoryGroupEnabled(kThreadpoolAsyncCat);
    const syncEnabled = isCategoryGroupEnabled(kThreadpoolSyncCat);
    if (!asyncEnabled && !syncEnabled) return original.$apply(this, args);
    if (asyncEnabled) emitEvent("b", kThreadpoolAsyncCat, traceName);
    args[args.length - 1] = function (...callbackArgs) {
      if (syncEnabled) {
        emitEvent("b", kThreadpoolSyncCat, traceName);
        emitEvent("e", kThreadpoolSyncCat, traceName);
      }
      if (asyncEnabled) emitEvent("e", kThreadpoolAsyncCat, traceName);
      return callback.$apply(this, callbackArgs);
    };
    try {
      return original.$apply(this, args);
    } catch (err) {
      // Balance the 'b' when the call throws synchronously (argument
      // validation, e.g. a bad zlib level or hkdf digest), mirroring
      // wrapFsAsyncMethod — the wrapped callback never runs in that case.
      if (asyncEnabled) emitEvent("e", kThreadpoolAsyncCat, traceName);
      throw err;
    }
  };
}

export default {
  enableCategories,
  disableCategories,
  getEnabledCategories,
  getCategoryEnabledBuffer,
  isTraceCategoryEnabled,
  isCategoryGroupEnabled,
  emitEvent,
  emitEventWithArgs,
  trace,
  initFromCli,
  setFilePattern,
  setTid,
  emitWorkerThreadName,
  inspectorStart,
  inspectorStop,
  rawWriteSync,
  rawReadFileSync,
};
