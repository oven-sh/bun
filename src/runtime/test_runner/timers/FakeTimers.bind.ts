import * as b from "../../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::test_runner::timers::fake_timers" });

/** Returns `this`, which is `jest` or `vi`. */
const chainable = { passThis: true, returns: b.any, capability: "js", throws: true } as const;
/** `async` in Vitest and Jest, so it rejects where the sync one throws. */
const chainableAsync = { ...chainable, rejects: true } as const;

const milliseconds = (name: string) =>
  ({
    args: { milliseconds: b.f64 },
    expected: { milliseconds: `${name}() expects a number of milliseconds` },
  }) as const;
const steps = (name: string) =>
  ({
    args: { steps: b.f64.optional },
    expected: { steps: `${name}() expects a number of steps` },
  }) as const;

/** What `options` can hold depends on whose `useFakeTimers` it is, so `Options::from_js` reads it. */
const useFakeTimers = { ...chainable, args: { options: b.any } } as const;
export const viUseFakeTimers = b.fn({ ...useFakeTimers, export: "Bun__FakeTimers__viUseFakeTimers" });
export const jestUseFakeTimers = b.fn({ ...useFakeTimers, export: "Bun__FakeTimers__jestUseFakeTimers" });
export const vitestUseFakeTimers = b.fn({ ...useFakeTimers, export: "Bun__FakeTimers__vitestUseFakeTimers" });

export const useRealTimers = b.fn({ ...chainable, export: "Bun__FakeTimers__useRealTimers" });
export const advanceTimersToNextTimer = b.fn({
  ...chainable,
  ...steps("advanceTimersToNextTimer"),
  export: "Bun__FakeTimers__advanceTimersToNextTimer",
});
export const advanceTimersByTime = b.fn({
  ...chainable,
  ...milliseconds("advanceTimersByTime"),
  export: "Bun__FakeTimers__advanceTimersByTime",
});
export const advanceTimersToNextFrame = b.fn({ ...chainable, export: "Bun__FakeTimers__advanceTimersToNextFrame" });
export const runOnlyPendingTimers = b.fn({ ...chainable, export: "Bun__FakeTimers__runOnlyPendingTimers" });
export const runAllTimers = b.fn({ ...chainable, export: "Bun__FakeTimers__runAllTimers" });
export const runAllTicks = b.fn({ ...chainable, export: "Bun__FakeTimers__runAllTicks" });
export const runAllImmediates = b.fn({ ...chainable, export: "Bun__FakeTimers__runAllImmediates" });

const advanceTimersByTimeAsync = { ...chainableAsync, ...milliseconds("advanceTimersByTimeAsync") } as const;
export const viAdvanceTimersByTimeAsync = b.fn({
  ...advanceTimersByTimeAsync,
  export: "Bun__FakeTimers__viAdvanceTimersByTimeAsync",
});
export const jestAdvanceTimersByTimeAsync = b.fn({
  ...advanceTimersByTimeAsync,
  export: "Bun__FakeTimers__jestAdvanceTimersByTimeAsync",
});
const advanceTimersToNextTimerAsync = { ...chainableAsync, ...steps("advanceTimersToNextTimerAsync") } as const;
export const viAdvanceTimersToNextTimerAsync = b.fn({
  ...advanceTimersToNextTimerAsync,
  export: "Bun__FakeTimers__viAdvanceTimersToNextTimerAsync",
});
export const jestAdvanceTimersToNextTimerAsync = b.fn({
  ...advanceTimersToNextTimerAsync,
  export: "Bun__FakeTimers__jestAdvanceTimersToNextTimerAsync",
});
export const viRunAllTimersAsync = b.fn({ ...chainableAsync, export: "Bun__FakeTimers__viRunAllTimersAsync" });
export const jestRunAllTimersAsync = b.fn({ ...chainableAsync, export: "Bun__FakeTimers__jestRunAllTimersAsync" });
export const viRunOnlyPendingTimersAsync = b.fn({
  ...chainableAsync,
  export: "Bun__FakeTimers__viRunOnlyPendingTimersAsync",
});
export const jestRunOnlyPendingTimersAsync = b.fn({
  ...chainableAsync,
  export: "Bun__FakeTimers__jestRunOnlyPendingTimersAsync",
});

/** Vitest takes `(mode, interval?)` and Jest takes `({ mode, delta? })`. */
export const setTimerTickMode = b.fn({
  ...chainable,
  export: "Bun__FakeTimers__setTimerTickMode",
  args: { mode: b.any, interval: b.any },
});
export const getTimerCount = b.fn({
  export: "Bun__FakeTimers__getTimerCount",
  returns: b.usize,
  capability: "heap",
  throws: true,
});
export const clearAllTimers = b.fn({ ...chainable, export: "Bun__FakeTimers__clearAllTimers" });
export const isFakeTimers = b.fn({ export: "Bun__FakeTimers__isFakeTimers", returns: b.bool });
export const getMockedSystemTime = b.fn({
  export: "Bun__FakeTimers__getMockedSystemTime",
  returns: b.f64.asDate.nullable,
  capability: "heap",
});
export const getRealSystemTime = b.fn({ export: "Bun__FakeTimers__getRealSystemTime", returns: b.f64 });
