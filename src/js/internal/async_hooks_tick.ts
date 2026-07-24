// Bridge between node:async_hooks createHook() and the process.nextTick
// queue (builtins/ProcessObjectInternals.ts). Enabled `init` hooks are pushed
// into `tickInitHooks` so the nextTick hot path pays only an array-length
// check when no hook is enabled.
//
// The array identity must stay stable (push/splice only, never reassign):
// the nextTick closure captures it once at setup.
//
// Currently only TickObject (process.nextTick) and WORKER `init` events are
// delivered; promise, timer and other native resource events are still
// unimplemented.
const tickInitHooks = [];
let nextAsyncId = 1;

export default {
  tickInitHooks,
  newAsyncId() {
    return ++nextAsyncId;
  },
};
