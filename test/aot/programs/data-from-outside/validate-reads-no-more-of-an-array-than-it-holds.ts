// An array says how long it is, and an array without a single element can say 4,294,967,295: a structured clone carries it in a few bytes. validate<T> does nothing once for each index up to such a length. The rules of length come first, an element is read when it is looked at, a hole is read as undefined and refused where the type does not take undefined, and where it does, the call ends in a RangeError after 65,536 holes. An array is read by its length and its indices, each once, and its iterator is not asked.
import { validate } from "bun:bundle";
import type { Schema } from "bun";
import { deserialize, serialize } from "node:v8";

function attempt(name: string, run: () => unknown): void {
  try {
    const value: any = run();
    console.log(name + ": " + (Array.isArray(value) ? "an array of " + value.length : typeof value));
  } catch (error: any) {
    console.log(name + ": " + error.name + ": " + error.message + (error.issues ? " [" + error.issues.length + " issues]" : ""));
  }
}
function holding(length: number, ...held: [number, unknown][]): any[] {
  const array: any[] = [];
  array.length = length;
  for (const [index, value] of held) array[index] = value;
  return array;
}
const saying = (length: unknown): any => new Proxy([], { get: (target, key, receiver) => (key === "length" ? length : Reflect.get(target, key, receiver)) });

console.log("bytes of a message that holds an array of 1,000,000 holes: " + serialize(holding(1_000_000)).length);
attempt("number[], out of that message", () => validate<number[]>(deserialize(serialize(holding(1_000_000)))));
attempt("unknown[], out of that message", () => validate<unknown[]>(deserialize(serialize(holding(1_000_000)))));
attempt("unknown[], a clone", () => validate<unknown[]>(structuredClone(holding(1_000_000))));
for (const length of [4294967295, 30_000_000, 65_537, 65_536, 3]) {
  console.log("length " + length);
  attempt("number[]", () => validate<number[]>(holding(length)));
  attempt("number[] of at most ten", () => validate<number[] & Schema.MaxItems<10>>(holding(length)));
  attempt("unknown[] of at most ten", () => validate<unknown[] & Schema.MaxItems<10>>(holding(length)));
  attempt("unknown[]", () => validate<unknown[]>(holding(length)));
  attempt("any[]", () => validate<any[]>(holding(length)));
  attempt("(number | undefined)[]", () => validate<(number | undefined)[]>(holding(length)));
  attempt("(number | undefined)[], the first and the last are there", () => validate<(number | undefined)[]>(holding(length, [0, 1], [length - 1, 2])));
  attempt("number[], the first is there", () => validate<number[]>(holding(length, [0, 1])));
  attempt("[number, number]", () => validate<[number, number]>(holding(length)));
  attempt("{ list: string[] }", () => validate<{ list: string[] }>({ list: holding(length) }));
  attempt("{ list: unknown[] }", () => validate<{ list: unknown[] }>({ list: holding(length) }));
  attempt("unknown[][]", () => validate<unknown[][]>([holding(length), holding(length)]));
  attempt("Record<string, number>", () => validate<Record<string, number>>(holding(length)));
  attempt("Record<string, unknown> | unknown[]", () => validate<Record<string, unknown> | unknown[]>(holding(length)));
  attempt("number[] | string[]", () => validate<number[] | string[]>(holding(length)));
  attempt("number[] | object", () => validate<number[] | object>(holding(length)));
  attempt("unknown", () => validate<unknown>(holding(length)));
  attempt("object", () => validate<object>(holding(length)));
  attempt("number[], a Proxy says the length", () => validate<number[]>(saying(length)));
  attempt("unknown[], a Proxy says the length", () => validate<unknown[]>(saying(length)));
  attempt("unknown[], with an accessor", () => validate<unknown[]>(Object.defineProperty(holding(length), 0, { get: () => 1, enumerable: true })));
  attempt("number[], nobody looks at the error", () => {
    try {
      return validate<number[]>(holding(length));
    } catch {
      return "refused";
    }
  });
}

console.log("holes are counted in all the arrays of a value");
attempt("two arrays of 40,000 holes beside an accessor", () => validate<{ a: unknown[]; b: unknown[]; c: number }>({ a: holding(40_000), b: holding(40_000), get c() { return 1; } })); // prettier-ignore
attempt("one of them", () => validate<{ a: unknown[]; b: unknown[]; c: number }>({ a: holding(40_000), b: [], get c() { return 1; } })); // prettier-ignore

console.log("lengths that a Proxy says");
for (const length of [0, -1, 1.5, "2", NaN, Infinity, undefined, null, {}, 1n, Symbol.iterator]) attempt(String(length), () => validate<unknown[]>(saying(length)));

console.log("what is read, and how often");
function counted(array: unknown[]): [any, Record<string, number>] {
  const reads: Record<string, number> = {};
  const count = (what: string, key: PropertyKey): void => void (reads[what + " " + String(key)] = (reads[what + " " + String(key)] ?? 0) + 1);
  return [new Proxy(array, { get: (target, key, receiver) => (count("get", key), Reflect.get(target, key, receiver)), getOwnPropertyDescriptor: (target, key) => (count("own", key), Reflect.getOwnPropertyDescriptor(target, key)), ownKeys: target => (count("keys", ""), Reflect.ownKeys(target)), has: (target, key) => (count("has", key), Reflect.has(target, key)) }), reads]; // prettier-ignore
}
for (const [name, array, run] of [
  ["all fit", [1, 2, 3], (value: unknown) => validate<number[]>(value)],
  ["the second does not fit", [1, "two", 3], (value: unknown) => validate<number[]>(value)],
  ["too long", [1, 2, 3], (value: unknown) => validate<number[] & Schema.MaxItems<2>>(value)],
  ["the second arm takes it", [1, 2, "three"], (value: unknown) => validate<number[] | (number | string)[]>(value)],
  ["an arm that describes nothing takes it", [1, "two", 3], (value: unknown) => validate<number[] | object>(value)],
  ["a hole", [1, , 3], (value: unknown) => validate<(number | undefined)[]>(value)],
  ["a tuple", [1, "two"], (value: unknown) => validate<[number, string]>(value)],
  ["no tuple", [1, "two", 3], (value: unknown) => validate<[number, string]>(value)],
] as [string, unknown[], (value: unknown) => unknown][]) {
  const [proxy, reads] = counted(array);
  let answer: string;
  let counts: string;
  try {
    const result = run(proxy);
    counts = JSON.stringify(reads);
    answer = JSON.stringify(result);
  } catch (error: any) {
    counts = JSON.stringify(reads);
    answer = error.name + ": " + error.message;
  }
  console.log(name + ": " + answer + " " + counts);
}

console.log("an iterator of its own is not asked");
{
  const array: any = [1, 2, 3];
  array[Symbol.iterator] = function* () {
    yield "other";
  };
  attempt("number[]", () => JSON.stringify(validate<number[]>(array)));
  console.log(JSON.stringify(validate<number[]>(array)));
}

console.log("an array that changes while it is read");
{
  const array: any[] = [0, 2, 3, 4];
  Object.defineProperty(array, 0, { get: () => ((array.length = 1), 1), enumerable: true });
  attempt("shorter: number[]", () => validate<number[]>(array));
}
{
  const array: any[] = [0, 2];
  Object.defineProperty(array, 0, { get: () => (array.push(5, 6, 7), 1), enumerable: true });
  console.log("longer: " + JSON.stringify(validate<number[]>(array)));
}

console.log("long arrays that hold what they say");
{
  const numbers: number[] = [];
  for (let i = 0; i < 300_000; i++) numbers.push(i);
  attempt("300,000 numbers", () => validate<number[]>(numbers));
  const withAccessor: any[] = numbers.slice();
  Object.defineProperty(withAccessor, 5, { get: () => 5, enumerable: true });
  attempt("300,000 numbers and an accessor", () => validate<number[]>(withAccessor));
  const sparse: any[] = numbers.slice();
  sparse[5_000_000] = 1;
  sparse.length = 300_000;
  attempt("300,000 numbers in sparse storage", () => validate<number[]>(sparse));
}
