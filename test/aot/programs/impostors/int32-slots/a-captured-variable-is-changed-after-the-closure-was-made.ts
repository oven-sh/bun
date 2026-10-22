// The closure that stores into the field captures a variable, not a value: other closures over the same variable add to it, subtract from it, double it and count it up before the store happens.
// Every operand in sight is a small integer, and sums of integers look like integers. Doubling leaves int32 after 31 rounds, and the amounts that hidden callers add are fractions, -0 and NaN.
// A second class, for contrast, has the operations that give -0 and NaN out of integers alone: times, remainder and negation.
const unknownCodeRuns = process.argv.length > 99;
function handOver(value: object) {
  if (unknownCodeRuns) (globalThis as any).hook?.(value);
}
const odd: number[] = (
  JSON.parse(
    '["0.5","-0.5","-0","NaN","Infinity","-Infinity","2147483647","2147483648","-2147483643","-2147483644","-2147483645","-2147483646","-2147483647","-2147483648","-2147483649","4294967295","4294967296","1e21","5e-324","9007199254740993"]'
      .split("")
      .join(""),
  ) as string[]
).map(Number);
function exact(value: unknown): string {
  if (typeof value !== "number") return `${typeof value}:${String(value)}`;
  return `${Object.is(value, -0) ? "-0" : value}${Number.isInteger(value) ? "" : "~"}`;
}
class Tally { total = 0; }
class Wild { total = 0; }
function counter(tally: Tally) {
  let n = 1;
  return {
    store: () => { tally.total = n; },
    add: (amount: number) => { n += amount; },
    subtract: (amount: number) => { n = n - amount; },
    fromZero: () => { n = 0 - n; },
    double: () => { n += n; },
    up: () => { n++; },
    down: () => { --n; },
    reset: (to: number) => { n = to; },
  };
}
function wildCounter(wild: Wild) {
  let n = 1;
  return {
    store: () => { wild.total = n; },
    negate: () => { n = -n; },
    reset: (to: number) => { n = to; },
    times: (factor: number) => { n *= factor; },
    remainder: (by: number) => { n %= by; },
  };
}
function fresh() {
  const tally = new Tally();
  handOver(tally);
  return tally;
}
function freshWild() {
  const wild = new Wild();
  handOver(wild);
  return wild;
}
function show(tally: Tally | Wild) {
  return `${exact(tally.total)} ${exact(tally.total + 1)} ${exact(-tally.total)} ${JSON.stringify(tally)}`;
}
let sum = 0;
for (let i = 0; i < 2000; i++) {
  const tally = fresh();
  const c = counter(tally);
  c.add(i & 15);
  c.double();
  c.subtract(3);
  c.up();
  c.down();
  c.fromZero();
  c.store();
  const wild = freshWild();
  const w = wildCounter(wild);
  w.reset(i & 15);
  w.times(3);
  w.remainder(1000);
  w.negate();
  w.store();
  sum += tally.total + wild.total;
}
console.log("warm", sum);
{
  const tally = fresh();
  const c = counter(tally);
  const steps: string[] = [];
  for (let i = 0; i < 34; i++) {
    c.double();
    c.store();
    if (i >= 28) steps.push(show(tally));
  }
  console.log("doubled:", steps.join(" | "));
}
{
  const tally = fresh();
  const c = counter(tally);
  c.reset(2147483646);
  const steps: string[] = [];
  for (let i = 0; i < 3; i++) {
    c.up();
    c.store();
    steps.push(show(tally));
  }
  console.log("counted up:", steps.join(" | "));
  c.reset(-2147483642);
  steps.length = 0;
  for (let i = 0; i < 8; i++) {
    c.down();
    c.store();
    steps.push(show(tally));
  }
  console.log("counted down through the smallest:", steps.join(" | "));
  c.reset(-1073741824);
  c.double();
  c.store();
  console.log("the smallest int32:", show(tally));
  c.fromZero();
  c.store();
  console.log("taken from zero:", show(tally));
}
{
  const wild = freshWild();
  const w = wildCounter(wild);
  w.reset(0);
  w.negate();
  w.store();
  console.log("zero negated:", show(wild), exact(1 / wild.total));
  w.reset(-4);
  w.remainder(2);
  w.store();
  console.log("-4 % 2:", show(wild), exact(1 / wild.total));
  w.reset(0);
  w.times(-5);
  w.store();
  console.log("0 * -5:", show(wild), exact(1 / wild.total));
  w.reset(5);
  w.remainder(0);
  w.store();
  console.log("5 % 0:", show(wild));
  w.reset(46341);
  w.times(46341);
  w.store();
  console.log("46341 squared:", show(wild));
}
for (const value of odd) {
  const tally = fresh();
  const c = counter(tally);
  c.reset(0);
  c.add.call(undefined, value);
  c.store();
  const added = show(tally);
  c.reset.apply(undefined, [value]);
  c.store();
  console.log(`${exact(value)}: added to zero ${added} | set ${show(tally)} ${Object.is(tally.total, value)}`);
}
