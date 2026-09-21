// Node calls into JS once for each libuv event, and after each call it runs
// every process.nextTick callback and every promise job, until both queues
// are empty. So the next event of a handle (the next chunk, the EOF) never
// runs ahead of a tick or a promise job that a listener of the previous event
// queued, however long the chain of ticks and jobs is.
// https://github.com/nodejs/node/blob/v24.9.0/lib/internal/process/task_queues.js#L72-L109
//
// A module that gets several of Node's events out of one native call gives
// each of them a drain of its own with `runAfterTickDrain`. The tick loop
// (processTicksAndRejections in builtins/ProcessObjectInternals.ts) runs one
// of these callbacks each time both queues are empty, where Node's loop calls
// processPromiseRejections(). That happens inside the drain that is running,
// so no other I/O callback runs in between.
//
// Only nextTicks and promise jobs run between two callbacks. Bun reports
// unhandled rejections after the whole drain, and Node reads a pipe once for
// each turn of the event loop, so there a setImmediate() of a listener also
// runs before the next event. A setImmediate() here would wait for that too,
// but fake timers replace it, and it costs a turn of the event loop for each
// chunk.
const asyncHooksTick = require("internal/async_hooks_tick");

type AfterTickDrainCallback = {
  callback: (arg: any) => void;
  arg: unknown;
  frame: import("../../node/async_hooks").Frame | undefined;
};

// A queue: entries before `head` are done. Bounded by the number of callers, which each wait for their turn.
const entries: (AfterTickDrainCallback | undefined)[] = [];
let head = 0;

function runAfterTickDrain(callback: (arg: any) => void, arg?: unknown) {
  let ensureTickLoop = asyncHooksTick.ensureTickLoop;
  if (ensureTickLoop === undefined) {
    // The first read of process.nextTick creates the tick queue. Fake timers read it before they replace it.
    void process.nextTick;
    ensureTickLoop = asyncHooksTick.ensureTickLoop;
    // process.nextTick was overwritten before its first read: there is no tick loop to wait for.
    if (ensureTickLoop === undefined) return process.nextTick(callback, arg);
  }
  ensureTickLoop();
  $arrayPush(entries, { callback, arg, frame: $getInternalField($asyncContext, 0) });
}

// The tick loop calls this each time both queues are empty. False: nothing waited.
function runAfterTickDrainCallback() {
  if (head === entries.length) return false;
  const { callback, arg, frame } = entries[head]!;
  entries[head++] = undefined;
  if (head === entries.length) {
    entries.length = 0;
    head = 0;
  }
  const restore = $getInternalField($asyncContext, 0);
  $putInternalField($asyncContext, 0, frame);
  // No catch and no finally, as for a tick: JSNextTickQueue::drain reports a throw inside the
  // callback's async context, puts the context back, and calls the tick loop again.
  callback(arg);
  $putInternalField($asyncContext, 0, restore);
  return true;
}
asyncHooksTick.runAfterTickDrainCallback = runAfterTickDrainCallback;

export default { runAfterTickDrain };
