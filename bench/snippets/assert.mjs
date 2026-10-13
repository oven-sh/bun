import * as assert from "assert";
import { bench, group, run } from "../runner.mjs";

bench("deepEqual", () => {
  assert.deepEqual({ foo: "123", bar: "baz" }, { foo: "123", bar: "baz" });
});

bench("deepStrictEqual", () => {
  assert.deepStrictEqual({ foo: "123", beep: "boop" }, { foo: "123", beep: "boop" });
});

group("partialDeepStrictEqual", () => {
  const length = 1000;
  const sequence = element => Array.from({ length }, (_, i) => element(i));
  const twice = element => [sequence(element), sequence(element)];

  const holeAtStart = sequence(i => i);
  delete holeAtStart[0];
  const everyOtherSlot = [];
  for (let i = 0; i < length; i += 2) everyOtherSlot[i] = i;

  const cases = {
    "1000 integers": twice(i => i),
    "1000 doubles": twice(i => i + 0.5),
    "1000 strings": twice(i => "s" + i),
    "1000 integers, actual frozen": [Object.freeze(sequence(i => i)), sequence(i => i)],
    "1000 arrays [1, 2]": twice(() => [1, 2]),
    "1000 objects": twice(i => ({ i })),
    "1000 arrays [1, , 3]": twice(() => [1, , 3]),
    "1000 integers, a hole at index 0": [holeAtStart, holeAtStart.slice()],
    "1000 slots, every other one a hole": [everyOtherSlot, everyOtherSlot.slice()],
    // 999 candidates are rejected before the last one matches.
    "the last of 1000 rows": [sequence(i => [i, 1]), [[length - 1, 1]]],
  };
  for (const [name, [actual, expected]] of Object.entries(cases)) {
    bench(name, () => {
      assert.partialDeepStrictEqual(actual, expected);
    });
  }
});

await run();
