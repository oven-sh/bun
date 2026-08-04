// Bridge between createHook() and the nextTick queue. Array identity must stay
// stable (push/splice only): the nextTick closure captures it once. Only
// TickObject/WORKER/MESSAGEPORT `init` events are delivered so far.
const tickInitHooks = [];
let nextAsyncId = 1;

// Called from MessageChannel::create once per port while a hook is enabled.
// https://github.com/nodejs/node/blob/main/src/node_messaging.cc (MessagePort is an AsyncWrap).
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
