// Bridge between node:async_hooks createHook() and the process.nextTick
// queue (builtins/ProcessObjectInternals.ts). Enabled `init` hooks are pushed
// into `tickInitHooks` so the nextTick hot path pays only an array-length
// check when no hook is enabled.
//
// The array identity must stay stable (push/splice only, never reassign):
// the nextTick closure captures it once at setup.
//
// Currently only TickObject (process.nextTick), WORKER and MESSAGEPORT `init`
// events are delivered; promise, timer and other native resource events are
// still unimplemented.
const tickInitHooks = [];
let nextAsyncId = 1;

// Called from MessageChannel::create (src/jsc/bindings/webcore/MessagePort.cpp)
// once per port. node's MessagePort is an AsyncWrap, so both ends of a channel
// emit a MESSAGEPORT `init` with the port itself as the resource
// (src/node_messaging.cc). The native side only calls this while a hook is
// enabled, so there is no fast-path cost here.
function emitMessagePortInit(port: object) {
  const count = tickInitHooks.length;
  if (count === 0) return;
  const asyncId = ++nextAsyncId;
  // Snapshot: enable()/disable() from inside a hook must not affect the
  // in-flight dispatch (node stages such mutations in tmp_array).
  const snapshot = $newArrayWithSize<Function>(count);
  for (let i = 0; i < count; i++) snapshot[i] = tickInitHooks[i];
  for (let i = 0; i < count; i++) {
    try {
      snapshot[i](asyncId, "MESSAGEPORT", 0, port);
    } catch (err) {
      // node: a throwing init hook is fatal (fatalError: print + exit 1) and is
      // never surfaced to whoever constructed the resource. console is
      // user-mutable, so shield the print.
      try {
        console.error(typeof (err as Error)?.stack === "string" ? (err as Error).stack : err);
      } catch {}
      process.exit(1);
    }
  }
}

export default {
  tickInitHooks,
  emitMessagePortInit,
  newAsyncId() {
    return ++nextAsyncId;
  },
};
