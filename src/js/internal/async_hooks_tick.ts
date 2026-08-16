// Bridge between node:async_hooks createHook() and the `init` emitters:
// process.nextTick (builtins/ProcessObjectInternals.ts) and the AsyncResource
// constructor. Emitters gate on tickInitHooks.length, so the hot paths pay
// nothing when no hook is enabled. The array identity must stay stable
// (push/splice only, never reassign): the nextTick closure captures it once.
const tickInitHooks = [];
let nextAsyncId = 1;

export default {
  tickInitHooks,
  newAsyncId() {
    return ++nextAsyncId;
  },
  emitInit(asyncId, type, triggerAsyncId, resource) {
    // .slice(): enable()/disable() from inside a hook must not affect the
    // in-flight dispatch (node's tmp_array staging).
    const hooks = tickInitHooks.slice();
    for (let i = 0; i < hooks.length; i++) {
      try {
        hooks[i](asyncId, type, triggerAsyncId, resource);
      } catch (err) {
        // node: a throwing init hook is fatal (print + exit 1), never
        // surfaced to the emitter's caller.
        try {
          console.error(typeof err?.stack === "string" ? err.stack : err);
        } catch {}
        process.exit(1);
      }
    }
  },
};
