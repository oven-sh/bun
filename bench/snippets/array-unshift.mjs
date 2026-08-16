import { bench, run } from "../runner.mjs";

bench("unshift x 16 into empty array", () => {
  const arr = [];
  for (let i = 0; i < 16; i++) {
    arr.unshift(i);
  }
  return arr;
});

bench("unshift 1 element into 128-element array", () => {
  const arr = new Array(128).fill(1);
  arr.unshift(0);
  return arr;
});

bench("shift all from 128-element array", () => {
  const arr = new Array(128).fill(1);
  while (arr.length > 0) arr.shift();
  return arr;
});

bench("queue: push + shift x 128", () => {
  const arr = [];
  for (let i = 0; i < 128; i++) arr.push(i);
  let sum = 0;
  while (arr.length > 0) sum += arr.shift();
  return sum;
});

await run();
