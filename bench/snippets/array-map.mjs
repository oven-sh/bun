// https://github.com/oven-sh/bun/issues/1096
import { bench, run } from "../runner.mjs";

const identity = x => x;

for (let i = 0; i < 20; i++) {
  var array = new Array(i);
  for (let j = 0; j < i; j++) {
    array[j] = 1;
  }

  bench("Array.map x " + i, () => array.map(identity));
}

bench("inline Array.map x 0", () => [].map(identity));
bench("inline Array.map x 1", () => [1].map(identity));
bench("inline Array.map x 2", () => [1, 1].map(identity));
bench("inline Array.map x 3", () => [1, 1, 1].map(identity));
bench("inline Array.map x 4", () => [1, 1, 1, 1].map(identity));
bench("inline Array.map x 5", () => [1, 1, 1, 1, 1].map(identity));
bench("inline Array.map x 6", () => [1, 1, 1, 1, 1, 1].map(identity));
bench("inline Array.map x 7", () => [1, 1, 1, 1, 1, 1, 1].map(identity));
bench("inline Array.map x 8", () => [1, 1, 1, 1, 1, 1, 1, 1].map(identity));
bench("inline Array.map x 9", () => [1, 1, 1, 1, 1, 1, 1, 1, 1].map(identity));
bench("inline Array.map x 10", () => [1, 1, 1, 1, 1, 1, 1, 1, 1, 1].map(identity));
bench("inline Array.map x 11", () => [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1].map(identity));
bench("inline Array.map x 12", () => [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1].map(identity));
bench("inline Array.map x 13", () => [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1].map(identity));
bench("inline Array.map x 14", () => [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1].map(identity));
bench("inline Array.map x 15", () => [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1].map(identity));
bench("inline Array.map x 16", () => [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1].map(identity));
bench("inline Array.map x 17", () => [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1].map(identity));
bench("inline Array.map x 18", () => [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1].map(identity));
bench("inline Array.map x 19", () => [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1].map(identity));

await run();
