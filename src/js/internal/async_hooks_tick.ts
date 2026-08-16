// Bridge between node:async_hooks createHook() and the places that emit
// `init` events: the process.nextTick queue (builtins/ProcessObjectInternals.ts)
// and the AsyncResource constructor (node/async_hooks.ts). Enabled `init`
// hooks are pushed into `tickInitHooks` so emitters pay only an array-length
// check when no hook is enabled.
//
// The array identity must stay stable (push/splice only, never reassign):
// the nextTick closure captures it once at setup.
//
// Currently TickObject and AsyncResource `init` events are delivered;
// promise, timer and native resource events are still unimplemented.
const tickInitHooks = [];
let nextAsyncId = 1;

export default {
  tickInitHooks,
  newAsyncId() {
    return ++nextAsyncId;
  },
  emitInit(asyncId, type, triggerAsyncId, resource) {
    // Snapshot: enable()/disable() from inside a hook must not affect the
    // in-flight dispatch (node stages such mutations in tmp_array until
    // the emit completes).
    const hooks = tickInitHooks.slice();
    for (let i = 0; i < hooks.length; i++) {
      try {
        hooks[i](asyncId, type, triggerAsyncId, resource);
      } catch (err) {
        // node: a throwing init hook is fatal (fatalError: print + exit 1),
        // never surfaced to the emitter's caller. console is a user-mutable
        // global, so shield the print; exit regardless.
        try {
          console.error(typeof err?.stack === "string" ? err.stack : err);
        } catch {}
        process.exit(1);
      }
    }
  },
};
