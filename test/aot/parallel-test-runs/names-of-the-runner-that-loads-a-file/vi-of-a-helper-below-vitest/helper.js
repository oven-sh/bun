export const own = () => vi;
export function fakes() {
  vi.useFakeTimers();
  const faked = [typeof setTimeout.clock, process.nextTick === realNextTick, queueMicrotask === realQueueMicrotask].join(" ");
  vi.useRealTimers();
  return faked;
}
const realNextTick = process.nextTick;
const realQueueMicrotask = queueMicrotask;
