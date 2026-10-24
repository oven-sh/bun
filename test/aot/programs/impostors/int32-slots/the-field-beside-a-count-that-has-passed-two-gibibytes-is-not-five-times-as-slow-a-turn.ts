// One field of an object no longer fits 32 bits. The field beside it still holds small integers, and a loop that touches that one alone goes on at a like pace.
class Counter {
  bytes = 0;
  chunks = 0;
}
function countMany(counter: Counter, turns: number) {
  let sum = 0;
  for (let turn = 0; turn < turns; turn++) {
    counter.chunks++;
    sum = (sum + counter.chunks) | 0;
  }
  return sum;
}
function fastestOf(runs: number, counter: Counter) {
  let fastest = Infinity;
  for (let run = 0; run < runs; run++) {
    const began = performance.now();
    countMany(counter, 4_000_000);
    fastest = Math.min(fastest, performance.now() - began);
  }
  return fastest;
}
function add(counter: Counter, length: number) {
  counter.bytes += length;
}
const counter = new Counter();
for (let turn = 0; turn < 100; turn++) add(counter, 65_536);
const before = fastestOf(5, counter);
for (let turn = 0; turn < 40_000; turn++) add(counter, 65_536);
const after = fastestOf(5, counter);
console.log(counter.bytes, counter.chunks, Object.keys(counter).join());
console.log(after < before * 5 ? "the field beside it takes under five times the time" : "the field beside it takes over five times the time");
