class Gauge { level = 5; }
const gauges: Gauge[] = [new Gauge(), new Gauge()];
gauges.push(JSON.parse('{"level":7}'));
function noise(): number { return JSON.parse("0"); }
function read(i: number): number {
  const g = gauges[i];
  const inverted = ~g.level;
  noise();
  return ~inverted + noise() + noise() + noise();
}
console.log(read(0), read(1), read(2));
