import { bench, run } from "../runner.mjs";

const small1 = [1, 2, 3, 4];
const small2 = [5, 6, 7, 8];
const medium1 = Array.from({ length: 128 }, (_, i) => i);
const medium2 = Array.from({ length: 128 }, (_, i) => i + 128);
const doubles1 = Array.from({ length: 128 }, (_, i) => i + 0.5);
const strings1 = Array.from({ length: 128 }, (_, i) => `item-${i}`);
const strings2 = Array.from({ length: 128 }, (_, i) => `item-${i + 128}`);

bench("concat: [4 ints].concat([4 ints])", () => {
  return small1.concat(small2);
});

bench("concat: [128 ints].concat([128 ints])", () => {
  return medium1.concat(medium2);
});

bench("concat: [128 ints].concat([128 doubles])", () => {
  return medium1.concat(doubles1);
});

bench("concat: [128 strings].concat([128 strings])", () => {
  return strings1.concat(strings2);
});

bench("concat: [128 ints].concat(1, 2, 3)", () => {
  return medium1.concat(1, 2, 3);
});

await run();
