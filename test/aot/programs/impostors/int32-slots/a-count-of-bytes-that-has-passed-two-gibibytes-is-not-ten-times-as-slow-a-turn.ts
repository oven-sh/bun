// A long-lived object adds up the bytes it has written. The sum starts at zero and one day no longer fits 32 bits. From then on a turn may cost a few times what it cost before, not ten times.
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
function fastestOf(runs: number, counter: Counter) {
  let fastest = Infinity;
  for (let run = 0; run < runs; run++) {
    const began = performance.now();
    writeMany(counter, 2_000_000, 3);
    fastest = Math.min(fastest, performance.now() - began);
  }
  return fastest;
}
const counter = new Counter();
const small = fastestOf(5, counter);
writeMany(counter, 40_000, 65_536);
const large = fastestOf(5, counter);
console.log(counter.bytes, counter.chunks, Object.keys(counter).join());
console.log(large < small * 10 ? "a turn past two gibibytes takes under ten times the time" : "a turn past two gibibytes takes over ten times the time");
