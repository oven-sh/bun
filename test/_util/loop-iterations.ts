// Helpers for fixtures that measure what one iteration of the event loop does:
// how many datagrams, reads or connections a socket hands over before the loop
// goes on to its timers, immediates and other sockets. For processes that run
// with bunEnv, which makes bun:internal-for-testing available.
import { getEventLoopStats } from "bun:internal-for-testing";

/**
 * Counts events by the iteration of the event loop they happen in. Call
 * `count()` from the callback to measure. `perIteration` has one entry for each
 * iteration that counted something, in order.
 */
export function iterationCounter() {
  const counts = new Map<number, number>();
  let total = 0;
  return {
    count(events = 1) {
      const { iteration } = getEventLoopStats();
      counts.set(iteration, (counts.get(iteration) ?? 0) + events);
      total += events;
    },
    get total() {
      return total;
    },
    summary() {
      const perIteration = [...counts.values()];
      return { total, max: Math.max(0, ...perIteration), perIteration };
    },
  };
}

/**
 * Lets the event loop iterate until `done()` holds. Resolves to false when it
 * still does not hold after `seconds`, so that the caller can report what it
 * has and not hang.
 */
export async function iterateUntil(done: () => boolean, seconds = 10) {
  const deadline = performance.now() + seconds * 1000;
  while (!done()) {
    if (performance.now() > deadline) return false;
    await new Promise<void>(resolve => setImmediate(resolve));
  }
  return true;
}

/**
 * Runs `scenario` until a run is `usable`, at most `attempts` times and within
 * `seconds` in all, and resolves to that run. A scenario that depends on what
 * the kernel had queued before the loop polled cannot promise it on every
 * platform and under every load, so a run that did not get there is set up
 * again. When no run is usable the last one is the result, for the test to
 * fail on.
 *
 * The scenario gets the seconds that are left of the budget. It passes them to
 * `iterateUntil`, so that a run whose datagrams never arrive ends with the
 * budget and not 20 deadlines later.
 */
export async function firstUsable<T extends object>(
  scenario: (secondsLeft: number) => Promise<T>,
  usable: (run: T) => boolean,
  { attempts = 20, seconds = 20 } = {},
) {
  const deadline = performance.now() + seconds * 1000;
  for (let attempt = 1; ; attempt++) {
    const secondsLeft = Math.max(1, (deadline - performance.now()) / 1000);
    const run = await scenario(secondsLeft);
    if (usable(run) || attempt === attempts || performance.now() > deadline) return { ...run, attempt };
  }
}
