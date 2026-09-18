// Bridge between node:async_hooks createHook() and the `init` emitters:
// process.nextTick (builtins/ProcessObjectInternals.ts) and the AsyncResource
// constructor. Emitters gate on tickInitHooks.length, so the hot paths pay
// nothing when no hook is enabled. The array identity must stay stable
// (push/splice only, never reassign): the nextTick closure captures it once.
const tickInitHooks = [];
let nextAsyncId = 1;

// Current scope's execution/trigger async ids: 1/0 at the root like Node.
// AsyncResource.runInAsyncScope (node/async_hooks.ts) swaps in the resource's
// ids; other async boundaries don't update them. Lives here so both `init`
// emitters can report them.
let currentExecutionAsyncId = 1;
let currentTriggerAsyncId = 0;

export default {
  tickInitHooks,
  newAsyncId() {
    return ++nextAsyncId;
  },
  executionAsyncId() {
    return currentExecutionAsyncId;
  },
  triggerAsyncId() {
    return currentTriggerAsyncId;
  },
  setCurrentAsyncIds(executionAsyncId, triggerAsyncId) {
    currentExecutionAsyncId = executionAsyncId;
    currentTriggerAsyncId = triggerAsyncId;
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
