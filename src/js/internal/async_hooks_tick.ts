// Bridge between node:async_hooks createHook() and the process.nextTick
// queue (builtins/ProcessObjectInternals.ts). Enabled `init` hooks are pushed
// into `tickInitHooks` so the nextTick hot path pays only an array-length
// check when no hook is enabled.
//
// The array identity must stay stable (push/splice only, never reassign):
// the nextTick closure captures it once at setup.
//
// Currently only TickObject `init` events are delivered (enough for
// console.log/stream.write tick-coalescing tests); promise, timer and native
// resource events are still unimplemented.
const tickInitHooks: Array<(asyncId: number, type: string, triggerAsyncId: number, resource: object) => void> = [];
let nextAsyncId = 1;

export default {
  tickInitHooks,
  newAsyncId() {
    return ++nextAsyncId;
  },
  // For internal/process/after_tick_drain.ts. Set when process.nextTick is first read, which creates the tick queue.
  ensureTickLoop: undefined as (() => void) | undefined,
  // Set by internal/process/after_tick_drain.ts. The tick loop calls it each time both queues are empty.
  runAfterTickDrainCallback: undefined as (() => boolean) | undefined,
};
