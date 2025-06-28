import { bench, run } from "../runner.mjs";
var comparator = (a, b) => a - b;

const numbers = [
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 31, 30, 29, 28, 27, 26, 25, 24, 23, 22, 21, 20, 19, 18, 17, 16,
  32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 63, 62, 61, 60, 59, 58, 57, 56, 55, 54, 53, 52, 51,
  50, 49, 48.9,
];

const presorted = numbers.slice().sort(comparator);

bench(`Array.sort (${numbers.length} num, unsorted)`, () => {
  [
    0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 31, 30, 29, 28, 27, 26, 25, 24, 23, 22, 21, 20, 19, 18, 17,
    16, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 63, 62, 61, 60, 59, 58, 57, 56, 55, 54, 53, 52,
    51, 50, 49, 48.9,
  ].sort(comparator);
});

bench(`Array.sort (${numbers.length} num, pre-sorted)`, () => {
  presorted.sort(comparator);
});

run();
