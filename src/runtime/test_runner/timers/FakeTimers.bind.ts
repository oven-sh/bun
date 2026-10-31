import * as b from "../../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::test_runner::timers::fake_timers" });

/** Returns `this`, which is `jest` or `vi`. */
const chainable = { passThis: true, returns: b.any, capability: "js", throws: true } as const;

export const FakeTimersOptions = b.dictionary(
  { now: b.f64.allowDate.optional },
  { allowArray: true, reportedAs: "options" },
);
/** Jest 26 took `"modern"` or `"legacy"`. The string is ignored. */
export const FakeTimersImplementationOrOptions = b.union({
  implementation: b.string.allowStringObject,
  options: FakeTimersOptions,
});

export const useFakeTimers = b.fn({
  ...chainable,
  export: "Bun__FakeTimers__useFakeTimers",
  args: { options: FakeTimersImplementationOrOptions.optional },
  expected: { options: "useFakeTimers() expects an options object" },
});
export const useRealTimers = b.fn({ ...chainable, export: "Bun__FakeTimers__useRealTimers" });
export const advanceTimersToNextTimer = b.fn({ ...chainable, export: "Bun__FakeTimers__advanceTimersToNextTimer" });
export const advanceTimersByTime = b.fn({
  ...chainable,
  export: "Bun__FakeTimers__advanceTimersByTime",
  args: { milliseconds: b.f64 },
  expected: { milliseconds: "advanceTimersByTime() expects a number of milliseconds" },
});
export const runOnlyPendingTimers = b.fn({ ...chainable, export: "Bun__FakeTimers__runOnlyPendingTimers" });
export const runAllTimers = b.fn({ ...chainable, export: "Bun__FakeTimers__runAllTimers" });
export const getTimerCount = b.fn({
  export: "Bun__FakeTimers__getTimerCount",
  returns: b.usize,
  capability: "heap",
  throws: true,
});
export const clearAllTimers = b.fn({ ...chainable, export: "Bun__FakeTimers__clearAllTimers" });
export const isFakeTimers = b.fn({ export: "Bun__FakeTimers__isFakeTimers", returns: b.bool });
