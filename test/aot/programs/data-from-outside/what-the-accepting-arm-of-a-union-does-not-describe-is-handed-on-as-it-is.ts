// One arm of a union describes a member and refuses it. The arm that takes the value says `unknown`, `object` or nothing about that member: what comes back there is the object that went in.
import { validate } from "bun:bundle";

class Money {
  constructor(public cents: number) {}
  toString(): string {
    return "$" + this.cents / 100;
  }
}
class Row extends Array<unknown> {}

const things: [string, () => object][] = [
  ["a Date", () => new Date(5)],
  ["a Map", () => new Map([[1, 2]])],
  ["a Set", () => new Set([1])],
  ["a RegExp", () => /x/g],
  ["an instance of a class", () => new Money(250)],
  ["a function", () => function () {}],
  ["a Uint8Array", () => new Uint8Array([1, 2])],
  ["an object without a prototype", () => Object.create(null)],
  ["an object with a member that is not enumerable", () => Object.defineProperty({ q: 1 }, "hidden", { value: 2 })],
  ["an object with an accessor", () => ({ get q() { return 1; } })], // prettier-ignore
  ["a frozen object", () => Object.freeze({ q: 1 })],
  ["a Proxy of an object", () => new Proxy({ q: 1 }, {})],
  ["an object", () => ({ q: 1 })],
  ["an array of a subclass", () => Row.from([1, "x", 3])],
  ["an array with a name", () => Object.assign([1, "x", 3], { named: 1 })],
  ["an array with a hole", () => [1, "x", , 4]],
  ["an array that says 4294967295 and holds two", () => Object.assign([1, "x"], { length: 4294967295 })],
  ["a Proxy of an array", () => new Proxy([1, "x", 3], {})],
  ["an array", () => [1, "x", 3]],
];

const types: [string, (value: unknown) => { a?: unknown }][] = [
  ["{ a: { b: number } } | { a: unknown }", value => validate<{ a: { b: number } } | { a: unknown }>(value)],
  ["{ a: { b: number } } | { a: object }", value => validate<{ a: { b: number } } | { a: object }>(value)],
  ["{ a: { b: number } } | {}", value => validate<{ a: { b: number } } | {}>(value)],
  ["{ a: { b: number } | number[] } | {}", value => validate<{ a: { b: number } | number[] } | {}>(value)],
  ["{ a: { b: number } | number[] | object }", value => validate<{ a: { b: number } | number[] | object }>(value)],
  ["{ a: number[] } | { c?: string }", value => validate<{ a: number[] } | { c?: string }>(value)],
  ["{ a: [number, number, number] } | { a: unknown }", value => validate<{ a: [number, number, number] } | { a: unknown }>(value)], // prettier-ignore
  ["Record<string, { b: number } | number[]> | {}", value => validate<Record<string, { b: number } | number[]> | {}>(value)],
  ["{ a: { b: number } | number[] } | Record<string, unknown>", value => validate<{ a: { b: number } | number[] } | Record<string, unknown>>(value)], // prettier-ignore
];

const holders: [string, (a: object) => object][] = [
  ["in an object", a => ({ a })],
  ["in a frozen object", a => Object.freeze({ a })],
  ["behind an accessor", a => ({ get a() { return a; } })], // prettier-ignore
  ["behind a Proxy", a => new Proxy({ a }, {})],
];

let same = 0;
for (const [type, run] of types) {
  for (const [thing, make] of things) {
    for (const [holder, hold] of holders) {
      const a = make();
      const value = hold(a);
      const result = run(value);
      if (result.a === a && result !== value) same++;
      else console.log(type + ", " + thing + " " + holder + ": " + (result === value ? "the value itself came back" : "another object came back"));
    }
  }
}
console.log(same + " of " + types.length * things.length * holders.length + " are the object that went in");

// The elements of a list, the values of a record and the value itself.
const when = new Date(5);
const list = validate<({ b: number } | object)[]>([{ b: 1 }, when, { b: "x" }]);
console.log(JSON.stringify(list[0]), list[1] === when, JSON.stringify(list[2]));
const rows = [1, "x", 3];
console.log(validate<number[] | object>(rows) === rows, validate<{ b: number } | object>(when) === when);
const record = validate<Record<string, number[] | unknown>>({ first: [1, 2], second: rows });
console.log(JSON.stringify(record), record.second === rows);

// Nothing behind the place where the first arm refused is read.
const reads: string[] = [];
const watched = new Proxy([1, "x", 3, 4], {
  get(target, key, receiver) {
    reads.push(String(key));
    return Reflect.get(target, key, receiver);
  },
});
console.log((validate<{ a: number[] } | {}>({ a: watched }) as { a: unknown }).a === watched, reads.join(" "));
