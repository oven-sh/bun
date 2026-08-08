// Bridge between node:async_hooks createHook() and the process.nextTick
// queue (builtins/ProcessObjectInternals.ts). Enabled `init` hooks are pushed
// into `tickInitHooks` so the nextTick hot path pays only an array-length
// check when no hook is enabled.
//
// The array identity must stay stable (push/splice only, never reassign):
// the nextTick closure captures it once at setup.
//
// This bridge delivers only TickObject `init` events (enough for
// console.log/stream.write tick-coalescing tests); promise and native resource
// events are still unimplemented. Timer lifecycle events are delivered
// separately by node/async_hooks.ts, which shares newAsyncId() below so timer
// and tick async ids never collide.
const tickInitHooks = [];
let nextAsyncId = 1;

export default {
  tickInitHooks,
  newAsyncId() {
    return ++nextAsyncId;
  },
};
