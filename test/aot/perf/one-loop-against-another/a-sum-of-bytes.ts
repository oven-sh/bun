// A long-lived object adds up the bytes it has written. The sum starts at zero and one day no longer fits 32 bits.
class Counter {
  bytes = 0;
  chunks = 0;
  write(length: number) {
    this.bytes += length;
    this.chunks++;
  }
}
function writeMany(counter: Counter, turns: number, length: number) {
  for (let turn = 0; turn < turns; turn++) counter.write(length);
}
const [loop = "past two gibibytes", turns = "5000"] = process.argv.slice(2);
const counter = new Counter();
writeMany(counter, 5000, 3);
writeMany(counter, 40_000, loop === "past two gibibytes" ? 65_536 : 1);
writeMany(counter, Number(turns), 3);
console.log(counter.bytes, counter.chunks, Object.keys(counter).join());
