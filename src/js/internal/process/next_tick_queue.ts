// @ts-check
const { setUp, nextTick } = require("internal/process/ticks");

function initializeNextTickQueue(process: typeof globalThis.process, nextTickQueue, drainMicrotasksFn) {
  setUp(process, nextTickQueue, drainMicrotasksFn);
  return nextTick;
}

export default initializeNextTickQueue;
