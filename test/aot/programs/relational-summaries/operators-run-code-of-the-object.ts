// An operator that meets an object calls its Symbol.toPrimitive, valueOf or toString, with the object as `this`: arithmetic, comparison, concatenation, a template, a computed key, a built-in that wants a number or a string. A helper that "only computes" with its parameters then keeps them, changes them and answers any kind of value.
function churn(depth: number): number {
  const pair = { left: depth, right: -depth };
  const list = [depth, depth + 1, depth + 2];
  const read = () => pair.left + list[1];
  if (depth > 0) return churn(depth - 1) + read();
  Bun.gc(true);
  return read();
}
const kept: { tag: string }[] = [];
const order: string[] = [];
class Money {
  constructor(
    public cents: number,
    public tag: string,
  ) {}
  valueOf(): number {
    kept.push(this);
    order.push("valueOf " + this.tag);
    return this.cents;
  }
  toString(): string {
    kept.push(this);
    order.push("toString " + this.tag);
    return "$" + this.cents;
  }
}
class Exotic {
  constructor(public tag: string) {}
  [Symbol.toPrimitive](hint: string): string | number {
    kept.push(this);
    order.push(hint + " " + this.tag);
    return hint === "number" ? 42 : hint === "string" ? "exotic" : "default";
  }
}
function add(a: any, b: any): any {
  return a + b;
}
function subtract(a: any, b: any): any {
  return a - b;
}
function multiply(a: any, b: any): any {
  return a * b;
}
function less(a: any, b: any): boolean {
  return a < b;
}
function atMost(a: any, b: any): boolean {
  return a <= b;
}
function looselyEqual(a: any, b: any): boolean {
  return a == b;
}
function negate(a: any): any {
  return -a;
}
function toNumber(a: any): number {
  return +a;
}
function increment(a: any): any {
  a++;
  return a;
}
function orZero(a: any): number {
  return a | 0;
}
function inTemplate(a: any): string {
  return `<${a}>`;
}
function asKey(o: Record<string, number>, key: any): number | undefined {
  return o[key];
}
function hasKey(o: object, key: any): boolean {
  return key in o;
}
function byBuiltIns(a: any): string {
  return [Math.max(a, 1), Math.abs(a), String(a), Number(a), isNaN(a), parseInt(a), [a].join(), "x".repeat(a > 40 ? 1 : 2), "abc".charAt(a), new Date(a).getTime()].join();
}
let sum = 0;
for (let i = 0; i < 300; i++) {
  sum += add(i, 1) + subtract(i, 1) + multiply(i, 2) + negate(i) + toNumber(i) + increment(i) + orZero(i) + (less(i, 5) ? 1 : 0) + (atMost(i, 5) ? 1 : 0) + (looselyEqual(i, 5) ? 1 : 0);
  sum += inTemplate(i).length + add("a", i).length + (asKey({ "1": 1 }, i) ?? 0) + (hasKey({ "2": 1 }, i) ? 1 : 0);
}
console.log(sum);
const flush = () => order.splice(0).join(", ");
const m = (tag: string, cents = 250) => new Money(cents, tag);
console.log(add(m("a"), m("b")), flush());
console.log(add(m("a"), "!"), add("!", m("b")), flush());
console.log(subtract(m("a"), m("b", 50)), multiply(m("a"), 2), negate(m("n")), toNumber(m("p")), increment(m("i")), orZero(m("o")), flush());
console.log(less(m("l"), m("r", 300)), atMost(m("l"), m("r", 100)), less(m("l"), NaN), atMost(m("l"), undefined), flush());
console.log(looselyEqual(m("e"), 250), looselyEqual(m("e"), "250"), looselyEqual(m("e"), m("f")), looselyEqual(m("e"), null), flush());
console.log(inTemplate(m("t")), asKey({ $250: 9 }, m("k")), hasKey({ $250: 9 }, m("h")), flush());
console.log(byBuiltIns(m("b", 2)), flush());
const x = (tag: string) => new Exotic(tag);
console.log(add(x("a"), x("b")), add(x("a"), 1), subtract(x("a"), 1), less(x("a"), 50), looselyEqual(x("a"), "default"), inTemplate(x("t")), asKey({ exotic: 3 }, x("k")), toNumber(x("n")), flush());
console.log(byBuiltIns(x("b")), flush());
console.log(churn(60), kept.length, kept[0].tag, kept[kept.length - 1].tag);

// Fresh objects, made for the one call, on a rare path of a hot loop.
kept.length = 0;
let mixed = 0;
for (let i = 0; i < 300; i++) {
  mixed += multiply(i % 100 === 99 ? new Money(i, "rare" + i) : i, 2);
  mixed += less(i % 100 === 98 ? new Exotic("rare exotic" + i) : i, 100) ? 1 : 0;
}
order.length = 0;
console.log(mixed, churn(60), kept.map(k => k.tag).join());

// The conversion changes the other operand, answers another kind each time, or throws.
const counter = {
  n: 0,
  valueOf() {
    return ++this.n;
  },
};
console.log(add(counter, counter), multiply(counter, counter), less(counter, counter), subtract(counter, counter));
const shifty = {
  calls: 0,
  [Symbol.toPrimitive]() {
    return [1, "two", 3n, true, null, undefined][this.calls++ % 6];
  },
};
const outcomes: string[] = [];
for (let i = 0; i < 6; i++) {
  try {
    const answer = add(shifty, 1);
    outcomes.push(typeof answer + " " + String(answer));
  } catch (error) {
    outcomes.push((error as Error).constructor.name);
  }
}
console.log(outcomes.join(" | "));
for (const bad of [{ valueOf: () => ({}), toString: () => ({}) }, Object.create(null), Symbol("s"), 1n]) {
  try {
    console.log(String(subtract(bad, 1)));
  } catch (error) {
    console.log((error as Error).constructor.name);
  }
}
