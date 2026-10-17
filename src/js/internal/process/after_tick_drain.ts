// Node empties the nextTick queue and the promise job queue between two libuv callbacks: https://github.com/nodejs/node/blob/v24.9.0/lib/internal/process/task_queues.js#L72-L109
const asyncHooksTick = require("internal/async_hooks_tick");
const Dequeue = require("internal/fifo");

type AfterTickDrainCallback = {
  callback: (arg: any) => void;
  arg: unknown;
  frame: import("../../node/async_hooks").Frame | undefined;
};

const entries = new Dequeue<AfterTickDrainCallback>();

// Runs `callback` once both queues are empty, inside the drain that is running. One callback for each such point.
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
  entries.push({ callback, arg, frame: $getInternalField($asyncContext, 0) });
}

// The tick loop calls this each time both queues are empty. False: nothing waited.
function runAfterTickDrainCallback() {
  const entry = entries.shift();
  if (entry === undefined) return false;
  const { callback, arg, frame } = entry;
  const restore = $getInternalField($asyncContext, 0);
  $putInternalField($asyncContext, 0, frame);
  // No catch and no finally, as for a tick: JSNextTickQueue::drain reports the throw and calls the tick loop again.
  callback(arg);
  $putInternalField($asyncContext, 0, restore);
  return true;
}
asyncHooksTick.runAfterTickDrainCallback = runAfterTickDrainCallback;

export default { runAfterTickDrain };
