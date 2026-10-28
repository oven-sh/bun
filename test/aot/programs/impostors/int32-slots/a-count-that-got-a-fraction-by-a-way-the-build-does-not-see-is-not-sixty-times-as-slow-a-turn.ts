// Every store that the build sees puts a small integer into the field. One that it does not see puts a fraction there, and the object goes on counting from it.
// From then on a turn may cost many times what it cost before, not sixty times: the way to the number is looked up once, not at every turn.
class Counter {
  count = 0;
  other = 0;
  step() {
    this.count++;
    this.other++;
  }
}
function stepMany(counter: Counter, turns: number) {
  for (let turn = 0; turn < turns; turn++) counter.step();
}
function fastestOf(runs: number, counter: Counter) {
  let fastest = Infinity;
  for (let run = 0; run < runs; run++) {
    const began = performance.now();
    stepMany(counter, 2_000_000);
    fastest = Math.min(fastest, performance.now() - began);
  }
  return fastest;
}
const counter = new Counter();
const whole = fastestOf(5, counter);
Reflect.set(counter, "count", 0.5);
const broken = fastestOf(5, counter);
console.log(counter.count, counter.other, Object.keys(counter).join());
console.log(broken < whole * 60 ? "a turn from a fraction takes under sixty times the time" : "a turn from a fraction takes over sixty times the time");
