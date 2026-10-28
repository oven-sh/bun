// CI ends a test file that has run for five minutes.
const lastStart = 200_000;

/**
 * Other work on the machine only adds to a time, a count of instructions or a peak of memory. What is over its bound is measured again, four times at most:
 * code that costs more does so every time.
 */
export async function measureUntilWithinBounds<T>(name: string, measure: () => T | Promise<T>, isWithinBounds: (measured: T) => boolean): Promise<T> {
  for (let attemptsLeft = 3; ; attemptsLeft--) {
    const measured = await measure();
    if (attemptsLeft === 0 || isWithinBounds(measured) || performance.now() > lastStart) return measured;
    console.error(`ASKED AGAIN: ${name}`);
  }
}
