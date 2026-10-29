// `p.count++`, `p.count -= 3`, `total += 5` on a number that has only ever been a small integer: it is kept in 32 bits and added to where it lies.
// At either end of int32 the sum no longer fits: it is the same number as in plain Bun, in the field, in the variable, as the value of the expression, and whatever is read next.
class Counter {
  count: number;
  other: number;
  constructor(count: number) {
    this.count = count | 0;
    this.other = 7;
  }
}
function up(p: Counter): Counter {
  p.count++;
  return p;
}
function down(p: Counter): Counter {
  p.count--;
  return p;
}
function upBy(p: Counter): Counter {
  p.count += 1000;
  p.other += 1;
  return p;
}
function downBy(p: Counter): Counter {
  p.count -= 1000;
  p.other -= 1;
  return p;
}
function twice(p: Counter): Counter {
  p.count++;
  p.count++;
  return p;
}
function valueBefore(p: Counter): number {
  return p.count++;
}
function valueBehind(p: Counter): number {
  return ++p.count;
}
function both(p: Counter, q: Counter): number {
  p.count++;
  q.count--;
  return p.count + q.count;
}
let total = 0;
function addToTotal(): number {
  total += 5;
  return total;
}
function counterFrom(start: number) {
  let n = start | 0;
  return { next: () => ++n, previous: () => --n, read: () => n };
}

const ends = [2147483647, 2147483646, 2147482647, 2147482648, 0, -1, -2147483648, -2147483647, -2147483643, -2147483642, -2147483644, -2147482648, -2147482649];
for (let round = 0; round < 3; round++) {
  for (const end of ends) {
    const line: unknown[] = [end];
    for (const act of [up, down, upBy, downBy, twice]) {
      const p = act(new Counter(end));
      line.push(p.count, p.other);
      act(p);
      line.push(p.count);
    }
    const p = new Counter(end);
    line.push(valueBefore(p), p.count, valueBehind(p), p.count);
    const same = new Counter(end);
    line.push(both(same, same), both(new Counter(end), new Counter(end)));
    const counter = counterFrom(end);
    line.push(counter.next(), counter.next(), counter.previous(), counter.previous(), counter.previous(), counter.read());
    console.log(line.join(" "));
  }
}
total = 2147483640;
console.log(addToTotal(), addToTotal(), addToTotal(), total);
total = 1.5;
console.log(addToTotal(), total);

// What is no longer a small integer, is frozen, or is no field any more is counted as ECMAScript says.
const fraction = new Counter(1);
fraction.count = 0.5;
console.log(up(fraction).count, down(down(fraction)).count, upBy(fraction).count);
const text = new Counter(1);
(text as any).count = "9";
console.log(up(text).count, typeof text.count);
const nothing = new Counter(1);
(nothing as any).count = undefined;
console.log(up(nothing).count);
const frozen = Object.freeze(new Counter(5));
try {
  up(frozen);
} catch (error) {
  console.log((error as Error).constructor.name);
}
console.log(frozen.count);
const watched = new Counter(5);
let reads = 0;
Object.defineProperty(watched, "count", { get: () => (reads++, 2147483647), set: value => console.log("set", value), configurable: true });
console.log(up(watched).count, valueBefore(watched), reads);
const deleted = new Counter(5);
delete (deleted as any).count;
console.log(up(deleted).count, "count" in deleted);
