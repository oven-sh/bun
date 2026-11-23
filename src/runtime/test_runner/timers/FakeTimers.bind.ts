import * as b from "../../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::test_runner::timers::fake_timers" });

/** Returns `this`, which is `jest` or `vi`. */
const chainable = { passThis: true, returns: b.any, capability: "js", throws: true } as const;
/** `async` in Vitest and Jest, so it rejects where the sync one throws. */
const chainableAsync = { ...chainable, rejects: true } as const;

/** `faked()` runs before an argument is read, so the body converts it. */
const milliseconds = { args: { milliseconds: b.any } } as const;
const steps = { args: { steps: b.any } } as const;

/** `jest` and `vi` each get a function of their own, since they differ when the timers are real. */
const perFlavor = (name: string, fn: Parameters<typeof b.fn>[0]) => [
  b.fn({ ...fn, export: `Bun__FakeTimers__vi${name}` }),
  b.fn({ ...fn, export: `Bun__FakeTimers__jest${name}` }),
];

/** What `options` can hold depends on whose `useFakeTimers` it is, so `Options::from_js` reads it. */
const useFakeTimers = { ...chainable, args: { options: b.any } } as const;
export const viUseFakeTimers = b.fn({ ...useFakeTimers, export: "Bun__FakeTimers__viUseFakeTimers" });
export const jestUseFakeTimers = b.fn({ ...useFakeTimers, export: "Bun__FakeTimers__jestUseFakeTimers" });
export const vitestUseFakeTimers = b.fn({ ...useFakeTimers, export: "Bun__FakeTimers__vitestUseFakeTimers" });

export const useRealTimers = b.fn({ ...chainable, export: "Bun__FakeTimers__useRealTimers" });
export const [viAdvanceTimersToNextTimer, jestAdvanceTimersToNextTimer] = perFlavor("AdvanceTimersToNextTimer", {
  ...chainable,
  ...steps,
});
export const [viAdvanceTimersByTime, jestAdvanceTimersByTime] = perFlavor("AdvanceTimersByTime", {
  ...chainable,
  ...milliseconds,
});
export const [viAdvanceTimersToNextFrame, jestAdvanceTimersToNextFrame] = perFlavor(
  "AdvanceTimersToNextFrame",
  chainable,
);
export const [viRunOnlyPendingTimers, jestRunOnlyPendingTimers] = perFlavor("RunOnlyPendingTimers", chainable);
export const [viRunAllTimers, jestRunAllTimers] = perFlavor("RunAllTimers", chainable);
export const [viRunAllTicks, jestRunAllTicks] = perFlavor("RunAllTicks", chainable);
export const runAllImmediates = b.fn({ ...chainable, export: "Bun__FakeTimers__runAllImmediates" });

export const [viAdvanceTimersByTimeAsync, jestAdvanceTimersByTimeAsync] = perFlavor("AdvanceTimersByTimeAsync", {
  ...chainableAsync,
  ...milliseconds,
});
export const [viAdvanceTimersToNextTimerAsync, jestAdvanceTimersToNextTimerAsync] = perFlavor(
  "AdvanceTimersToNextTimerAsync",
  { ...chainableAsync, ...steps },
);
export const [viRunAllTimersAsync, jestRunAllTimersAsync] = perFlavor("RunAllTimersAsync", chainableAsync);
export const [viRunOnlyPendingTimersAsync, jestRunOnlyPendingTimersAsync] = perFlavor(
  "RunOnlyPendingTimersAsync",
  chainableAsync,
);

/** Vitest takes `(mode, interval?)` and Jest takes `({ mode, delta? })`. */
export const [viSetTimerTickMode, jestSetTimerTickMode] = perFlavor("SetTimerTickMode", {
  ...chainable,
  args: { mode: b.any, interval: b.any },
});
export const viGetTimerCount = b.fn({
  export: "Bun__FakeTimers__viGetTimerCount",
  returns: b.usize,
  capability: "heap",
  throws: true,
});
/** It calls `console.warn` when the timers are real. */
export const jestGetTimerCount = b.fn({
  export: "Bun__FakeTimers__jestGetTimerCount",
  returns: b.usize,
  capability: "js",
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
