// One field of an object no longer fits 32 bits. The field beside it still holds small integers, and the loop touches that one alone.
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
function add(counter: Counter, length: number) {
  counter.bytes += length;
}
const [loop = "beside a sum past two gibibytes", turns = "5000"] = process.argv.slice(2);
const counter = new Counter();
for (let turn = 0; turn < 100; turn++) add(counter, 65_536);
countMany(counter, 5000);
for (let turn = 0; turn < 40_000; turn++) add(counter, loop === "beside a sum past two gibibytes" ? 65_536 : 1);
console.log(countMany(counter, Number(turns)), counter.bytes, counter.chunks, Object.keys(counter).join());
