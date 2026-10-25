// A type that can be validated declares names, and JSON has no symbols. The copy that validate<T>(value) returns holds what is under the names. A type that takes no undeclared key takes no symbol either.
import { validate } from "bun:bundle";
import type { Schema } from "bun";

const mark = Symbol("mark");
const other = Symbol.for("other");

type Point = { x: number; y?: number };
type Closed = Point & Schema.Strict;
type Line = { from: Point; to: Point };
type ClosedBelow = Line & Schema.DeepStrict;

function shown(value: unknown): string {
  if (typeof value !== "object" || value === null) return String(value);
  const parts: string[] = [];
  for (const key of Reflect.ownKeys(value)) parts.push(String(key) + ":" + shown((value as any)[key]));
  return "{" + parts.join() + "}";
}

function attempt(label: string, run: () => unknown): void {
  try {
    console.log(label + ": " + shown(run()));
  } catch (error: any) {
    console.log(label + ": " + error.name + ": " + error.message);
  }
}

class Pixel {
  x = 1;
  [mark] = "of a class";
}

const carriers: [string, () => any][] = [
  ["an object", () => ({ x: 1, [mark]: "kept" })],
  ["an object that got the key later", () => Object.assign(JSON.parse('{"x":1}'), { [mark]: "kept" })],
  ["a frozen object", () => Object.freeze({ x: 1, [mark]: "kept" })],
  ["an accessor under the symbol", () => ({ x: 1, get [mark]() { return "kept"; } })], // prettier-ignore
  ["an accessor under the name", () => ({ get x() { return 1; }, [mark]: "kept" })], // prettier-ignore
  ["a Proxy", () => new Proxy({ x: 1, [mark]: "kept" }, {})],
  ["an instance of a class", () => new Pixel()],
  ["an object without a prototype", () => Object.assign(Object.create(null), { x: 1, [mark]: "kept" })],
  ["two symbols", () => ({ [other]: 1, x: 1, [mark]: 2 })],
  ["a symbol that is not enumerable", () => Object.defineProperty({ x: 1 }, mark, { value: "hidden" })],
  ["a symbol that is inherited", () => Object.create({ [mark]: "above" }, { x: { value: 1, enumerable: true } })],
  ["no symbol", () => ({ x: 1 })],
];

for (const [label, make] of carriers) {
  attempt("open, " + label, () => validate<Point>(make()));
  attempt("closed, " + label, () => validate<Closed>(make()));
  attempt("a record, " + label, () => validate<Record<string, number>>(make()));
  attempt("an index signature, " + label, () => validate<{ x: number; [key: string]: number }>(make()));
  attempt("below, open, " + label, () => validate<Line>({ from: make(), to: { x: 2 } }));
  attempt("below, closed, " + label, () => validate<ClosedBelow>({ from: { x: 2 }, to: make() }));
  attempt("in a list, closed, " + label, () => validate<Closed[]>([{ x: 2 }, make()]));
  attempt("closed or open, " + label, () => validate<Closed | { x: number; z?: string }>(make()));
  attempt("closed or a text, " + label, () => validate<Closed | string>(make()));
}

// The value is not changed, and what the type says nothing about is the same object with all that it has.
const given = { x: 1, [mark]: "kept", more: { [mark]: "below" } };
const copy = validate<Point>(given);
console.log(shown(given), shown(copy), (copy as any).more === given.more);
const held = validate<{ a: unknown; b: object }>({ a: given, b: given });
console.log(held.a === given, held.b === given);

try {
  validate<ClosedBelow>({ from: { x: 1 }, to: { x: 2, [other]: 1, [mark]: 2 } });
} catch (error: any) {
  console.log(JSON.stringify(error.issues));
}

// Written in place.
attempt("written in place, open", () => validate<Point>({ x: 1, [mark]: "kept", y: 2 }));
attempt("written in place, closed", () => validate<Closed>({ x: 1, [mark]: "kept", y: 2 }));

// What a reviver returns is judged alike.
const marking = (key: string, value: any): any => (key === "" ? Object.assign(value, { [mark]: "revived" }) : value);
attempt("from a reviver, open", () => Object.keys(JSON.parse<Point>('{"x":1}', marking)).join());
attempt("from a reviver, closed", () => JSON.parse<Closed>('{"x":1}', marking));
