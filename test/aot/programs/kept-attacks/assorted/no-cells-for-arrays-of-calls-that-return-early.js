// 10,000 calls of a function like the `debug` of npm while it is switched off, directly and through a value, and 100 while it is switched on, when it changes and keeps its rest array.
// object-census.test.ts runs it without collections, so that the census at exit counts every array that was made. The output is that of plain Bun.
let enabled = false;
const kept = [];
function log(...args) {
  if (!enabled) return 0;
  args[0] = args.length;
  kept.push(args);
  return 1;
}
const table = { log };
const names = ["log"];
let sum = 0;
for (let i = 0; i < 10100; i++) {
  enabled = i >= 10000;
  const a = { n: i };
  sum += log(a, a, a) + table[names[i % names.length]](a, a, a, a, a);
}
console.log(sum, kept.length, kept[0].length, kept[1].length, kept[199][0], new Set(kept).size);
