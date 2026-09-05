// Bridge between node:async_hooks createHook() and the process.nextTick
// queue (builtins/ProcessObjectInternals.ts). Enabled hooks are pushed into
// `tickHooks` so the nextTick hot path pays only an array-length check when
// no hook is enabled.
//
// The array identity must stay stable (push/splice only, never reassign):
// the nextTick closure captures it once at setup.
//
// TickObject init/before/after/destroy are delivered; promise, timer and
// native resource events are still unimplemented.
const tickHooks: { init?; before?; after?; destroy? }[] = [];
let nextAsyncId = 1;

export default {
  tickHooks,
  // asyncId of the TickObject whose callback is currently executing, or 0.
  currentAsyncId: 0,
  newAsyncId() {
    return ++nextAsyncId;
  },
};
