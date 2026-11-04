const unseen = (0, eval)("(x) => x");
class Gauge { level = 5; }
const gauges: Gauge[] = [new Gauge(), new Gauge()];
gauges.push(unseen({ level: 7 }));
function noise(): number { return unseen(0); }
function read(i: number): number {
  const g = gauges[i];
  const inverted = ~g.level;
  noise();
  return ~inverted;
}
const run = unseen(read);
let total = 0;
for (let r = 0; r < 300; r++) total += run(r % 3);
console.log(total);
