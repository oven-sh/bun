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

const kAsyncHooksCat = "node,node.async_hooks";

function now(): number {
  // Trace-event timestamps are in microseconds.
  return Math.round(performance.now() * 1000);
}

function setTid(value: number) {
  tid = value;
}

function isTraceCategoryEnabled(category: string): boolean {
  return categoryRefs.has(category);
}

function isCategoryGroupEnabled(cat: string): boolean {
  if (categoryRefs.has(cat)) return true;
  if (!cat.includes(",")) return false;
  for (const part of cat.split(",")) {
    if (categoryRefs.has(part)) return true;
  }
  return false;
}

function enableCategories(categories: string[]) {
  for (const category of categories) {
    const refs = categoryRefs.get(category);
    if (refs === undefined) {
      categoryRefs.set(category, 1);
      everEnabled.add(category);
      const buffer = categoryBuffers.get(category);
      if (buffer) buffer[0] = 1;
    } else {
      categoryRefs.set(category, refs + 1);
    }
  }
  if (categories.length !== 0) activate();
}

function disableCategories(categories: string[]) {
  for (const category of categories) {
    const refs = categoryRefs.get(category);
    if (refs === undefined) continue;
    if (refs <= 1) {
      categoryRefs.delete(category);
      const buffer = categoryBuffers.get(category);
      if (buffer) buffer[0] = 0;
    } else {
      categoryRefs.set(category, refs - 1);
    }
  }
}

function getEnabledCategories(): string | undefined {
  if (categoryRefs.size === 0) return undefined;
  return Array.from(categoryRefs.keys()).join(",");
}

function getCategoryEnabledBuffer(category: string): Uint8Array {
  let buffer = categoryBuffers.get(category);
  if (!buffer) {
    buffer = new Uint8Array(1);
    buffer[0] = categoryRefs.has(category) ? 1 : 0;
    categoryBuffers.set(category, buffer);
  }
  return buffer;
}

function emitEvent(ph: string, cat: string, name: string, id?: number, data?: unknown) {
  const event: Record<string, unknown> = {
    pid: process.pid,
    tid,
    ts: now(),
    ph,
    cat,
    name,
  };
  if (id !== undefined) event.id = "0x" + id.toString(16);
  event.args = data === undefined ? {} : { data };
  events.push(event);
}

// internalBinding('trace_events').trace(phase, cat, name, id, data) — phase is
// a char code ('b'/'e'/'n'); events whose category group is not enabled are
// dropped; `id` is rendered as '0x' + hex; `data` lands under `args.data`.
function trace(phase: number, cat: string, name: string, id?: number, data?: unknown) {
  if (!isCategoryGroupEnabled(cat)) return;
  emitEvent(String.fromCharCode(phase), cat, name, id, data);
}

// CLI entry — called by internal/process/pre_execution before user code.
// `catString` is the resolved value of --trace-event-categories (last
// occurrence wins; --trace-events-enabled is an alias for
// "v8,node,node.async_hooks", matching Node).
function initFromCli(catString: string, pattern: string | null) {
  filePattern = pattern;
  const categories = catString.split(",").filter(category => category.length !== 0);
  enableCategories(categories);
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
}

function flush() {
  emitMetadata();
  if (everEnabled.has("v8")) {
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
  let fileName = filePattern ?? "node_trace.${rotation}.log";
  fileName = fileName.replaceAll("${pid}", String(process.pid)).replaceAll("${rotation}", "1");
  try {
    require("node:fs").writeFileSync(fileName, JSON.stringify({ traceEvents: events }));
  } catch {
    // Matches Node: failing to write the trace file is not fatal at exit.
  }
}

function emitMetadata() {
  const ts = 0;
  const pid = process.pid;
  function meta(name: string, args: unknown, metaTid: number = tid) {
    events.push({ pid, tid: metaTid, ts, ph: "M", cat: "__metadata", name, args });
  }
  meta("thread_name", { name: "JavaScriptMainThread" }, tid);
  meta("thread_name", { name: "PlatformWorkerThread" }, tid + 1);
  meta("version", { node: process.versions.node });
  const release: Record<string, unknown> = { name: process.release.name };
  if (process.release.lts) release.lts = process.release.lts;
  meta("node", {
    process: {
      versions: process.versions,
      arch: process.arch,
      platform: process.platform,
      release,
    },
  });
  meta("process_name", { name: initialTitle });
  if (process.title !== initialTitle) {
    meta("process_name", { name: process.title });
  }
}

// Timeout init/destroy events under "node,node.async_hooks". Bun's
// async_hooks ids are stubs, so synthesize monotonic ids; Node's shape is
// 'b' at init with args.data.{executionAsyncId,triggerAsyncId} and 'e' at
// destroy, both carrying the async id.
let timersInstrumented = false;
function installTimerInstrumentation() {
  if (timersInstrumented) return;
  timersInstrumented = true;
  globalThis.setTimeout = wrapTimerFunction(globalThis.setTimeout, false);
  globalThis.setInterval = wrapTimerFunction(globalThis.setInterval, true);
}

function wrapTimerFunction(original, isInterval: boolean) {
  function wrapped(callback, delay, ...args) {
    if (typeof callback === "function" && isCategoryGroupEnabled(kAsyncHooksCat)) {
      const asyncId = nextAsyncId++;
      emitEvent("b", kAsyncHooksCat, "Timeout", asyncId, {
        executionAsyncId: 1,
        triggerAsyncId: 1,
      });
      const inner = callback;
      callback = function (...callbackArgs) {
        try {
          return inner.$apply(this, callbackArgs);
        } finally {
          if (!isInterval) emitEvent("e", kAsyncHooksCat, "Timeout", asyncId);
        }
      };
    }
    return original(callback, delay, ...args);
  }
  // Preserve extra own properties (e.g. the promisify custom symbol).
  for (const key of Reflect.ownKeys(original)) {
    if (key === "length" || key === "name" || key === "prototype") continue;
    const desc = Object.getOwnPropertyDescriptor(original, key);
    if (desc) Object.defineProperty(wrapped, key, desc);
  }
  return wrapped;
}

export default {
  enableCategories,
  disableCategories,
  getEnabledCategories,
  getCategoryEnabledBuffer,
  isTraceCategoryEnabled,
  isCategoryGroupEnabled,
  emitEvent,
  trace,
  initFromCli,
  setTid,
};
