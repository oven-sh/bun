import { isDeepStrictEqual } from "node:util";
import { bench, group, run } from "../runner.mjs";

// Bun.deepEquals in Bun. Node runs the same shapes through util.isDeepStrictEqual.
const deepEquals = globalThis.Bun?.deepEquals ?? isDeepStrictEqual;

const object = (keys, value) => Object.fromEntries(Array.from({ length: keys }, (_, i) => ["k" + i, value(i)]));
// Two equal objects that share no cells.
const twice = o => [JSON.parse(JSON.stringify(o)), JSON.parse(JSON.stringify(o))];

group("50 keys", () => {
  const shared = object(50, i => ({ i, s: "v" + i, a: [i, i + 1] }));
  const copy = { ...shared };
  bench("values shared with a shallow copy", () => deepEquals(shared, copy));

  const [numbers1, numbers2] = twice(object(50, i => i + 0.5));
  bench("numbers", () => deepEquals(numbers1, numbers2));

  const [strings1, strings2] = twice(object(50, i => "value-" + i));
  bench("strings", () => deepEquals(strings1, strings2));

  const [wide1, wide2] = twice(object(50, i => "value-\u1234-" + i));
  bench("16-bit strings", () => deepEquals(wide1, wide2));

  const [nested1, nested2] = twice(object(50, i => ({ i, s: "v" + i })));
  bench("nested objects", () => deepEquals(nested1, nested2));

  const [unequal1, unequal2] = [object(50, i => i), object(50, i => (i === 49 ? -1 : i))];
  bench("numbers, last one differs", () => deepEquals(unequal1, unequal2));

  const reversed = Object.fromEntries(Object.entries(numbers1).reverse());
  bench("numbers, keys in reverse order", () => deepEquals(numbers1, reversed));
});

group("strings, by key count", () => {
  for (const keys of [4, 5, 8, 16]) {
    const [a, b] = twice(object(keys, i => "value-" + i));
    bench(`${keys} keys`, () => deepEquals(a, b));
  }
});

group("nested objects, by key count", () => {
  for (const keys of [4, 5, 8, 16]) {
    const [a, b] = twice(object(keys, i => ({ i, s: "v" + i })));
    bench(`${keys} keys`, () => deepEquals(a, b));
  }
});

await run();
