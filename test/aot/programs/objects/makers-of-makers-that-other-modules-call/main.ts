// The function that makes makers is exported by one module and called at the top level of another, with keys that a third exports.
import { describe, makeCounter, makePrimitive, type Made } from "./makers.ts";
import { args, evaluate } from "./keys.ts";

const double = makePrimitive({ op: "Double", [evaluate](this: Made, by: number) { return (this[args] as number) * 2 + by; } });
const negate = makePrimitive({ op: "Negate", [evaluate](this: Made, by: number) { return -(this[args] as number) + by; } });
const text = makePrimitive({ op: "Text", [evaluate](this: Made, by: number) { return String(this[args]).length + by; } });
const counters = [makeCounter("a"), makeCounter("b")];

function total(count: number): number {
  let sum = 0;
  for (let index = 0; index < count; index++) {
    const made = index % 3 === 0 ? double(index & 7) : index % 3 === 1 ? negate(index & 7) : text("x".repeat(index & 3));
    sum += made[evaluate](1);
  }
  return sum;
}

console.log(total(3000), describe(double(1)), describe(negate(2)), describe(text("abc")));
console.log(counters.map(counter => [counter.next().count, counter.next().count, counter.next().label].join()).join(" "));
const members = Object.getPrototypeOf(negate(0));
Object.defineProperty(members, args, { set() {}, get() { return 100; }, configurable: true });
console.log(total(3000), Object.keys(negate(1)).length, Object.keys(double(1)).length);
delete members[args];
console.log(total(3000), Object.getPrototypeOf(double(0)) === Object.getPrototypeOf(text("")), double.name, double.length);
