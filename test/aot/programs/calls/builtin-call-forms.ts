// Every way a call of a built-in is compiled: inline with and without a slow path, a call of the real function (host, internal, more arguments than registers), a constant, a cached getter, several results. Each runs once in cold code and again in a loop.
const lines: string[] = [];
function textOf(value: unknown): string {
  if (typeof value === "symbol") return value.toString();
  if (Object.is(value, -0)) return "-0";
  return Array.isArray(value) ? "[" + value.map(textOf).join(", ") + "]" : String(value);
}
function show(label: string, ...values: unknown[]): void {
  lines.push(label + ": " + values.map(textOf).join(" | "));
}
function attempt(label: string, run: () => unknown): void {
  try {
    show(label, run());
  } catch (error: any) {
    show(label, "throws " + error.constructor.name);
  }
}

function elementAt(list: number[], index: number): number | undefined {
  return list.at(index);
}
function characterAt(text: string, index: number): string | undefined {
  return text.at(index);
}
function truncate(list: number[], length: number): number {
  list.length = length;
  return list.length;
}
const numbers = [10, 20, 30];
show("at of an array", elementAt(numbers, 1), elementAt(numbers, -1), elementAt(numbers, 3), elementAt(numbers, 0.5), elementAt(numbers, -0.5), elementAt(numbers, NaN), elementAt(numbers, 1e10), [].at(0.5));
show("at of a string", characterAt("abc", 1), characterAt("abc", -1), characterAt("abc", 1.9), characterAt("abc", -Infinity), "a".at(1e10), "a".at(0));
attempt("length set", () => truncate([1, 2, 3], 1));
attempt("length set to a fraction", () => truncate([1, 2, 3], 1.5));
attempt("length set past the limit", () => truncate([1, 2, 3], 2 ** 32));

function magnitude(value: number): number {
  return Math.abs(value);
}
show("Math.abs", magnitude(-3), magnitude(-0), magnitude(2.5), magnitude(NaN), magnitude(-Infinity));

show("a host function", JSON.stringify(Bun.inspect({ a: 1, b: [2, "c"] })), Bun.inspect("text"), Bun.inspect(undefined));

function listOfLength(length: number): number {
  return Array(length).length;
}
function newListOfLength(length: number): number {
  return new Array(length).length;
}
function timeOf(milliseconds: number): string {
  return new Date(milliseconds).toISOString();
}
show("internal functions called", Array(3).length, listOfLength(0), Array(1, 2).join("+"), String(12), Number("7"), Boolean(0), typeof Object(1), typeof Date());
show("internal functions constructed", new Date(0).getTime(), timeOf(0), timeOf(86400000), newListOfLength(3), new Map().size, new Error("message").message, typeof new String("s"));
attempt("Array of a negative length", () => listOfLength(-1));
attempt("new Array of a fraction", () => newListOfLength(1.5));
attempt("an invalid Date", () => timeOf(NaN));
attempt("Symbol constructed", () => new (Symbol as any)());

function largestOfTwelve(base: number): number {
  return Math.max(base + 1, base + 2, base + 3, base + 4, base + 5, base + 6, base + 7, base + 8, base + 9, base + 10, base + 11, base + 12);
}
function largestOfTwelveValues(a: any, b: any): number {
  return Math.max(a, b, a, b, a, b, a, b, a, b, a, b);
}
function listOfTwelve(base: number): number[] {
  return new Array(base + 1, base + 2, base + 3, base + 4, base + 5, base + 6, base + 7, base + 8, base + 9, base + 10, base + 11, base + 12);
}
let conversions = 0;
const counted = {
  valueOf() {
    conversions++;
    return 9;
  },
};
show("Math.max of twelve", largestOfTwelve(0), largestOfTwelve(-20), largestOfTwelve(NaN), largestOfTwelveValues("5", counted), conversions, largestOfTwelveValues(1, undefined), Math.max());
attempt("Math.max of a symbol", () => largestOfTwelveValues(1, Symbol.iterator));
show("new Array of twelve", listOfTwelve(0), listOfTwelve(0.5).length, Array.isArray(listOfTwelve(1)));

show("constants", Math.PI, Number.MAX_SAFE_INTEGER, Number.EPSILON > 0, Infinity, NaN, undefined, Symbol.iterator, typeof Symbol.iterator, Symbol.iterator === (Symbol.asyncIterator as symbol));
show("a symbol as a key", numbers[Symbol.iterator]().next().value, typeof ({} as any)[Symbol.iterator], Array.prototype[Symbol.iterator] === Array.prototype.values);

const largest = Math.max, isList = Array.isArray, listFrom = Array.from, keysOf = Object.keys, resolve = Promise.resolve;
show("without a receiver", largest(1, 5), isList(numbers), isList("no"), listFrom("ab"), keysOf({ a: 1, b: 2 }));
attempt("Promise.resolve without a receiver", () => resolve(1));

show("call and apply", Math.max.call(null, 1, 2), Math.max.apply(undefined, [3, 4]), Array.prototype.at.call(numbers, -1), Array.prototype.at.call("xyz", 1), Array.prototype.at.call({ length: 2, 0: "first", 1: "second" }, 1.5));
attempt("at of null", () => Array.prototype.at.call(null, 0));

class Reversed extends Array<number> {
  at(index: number): number | undefined {
    return super.at(-1 - index);
  }
}
const reversed = new Reversed();
reversed.push(1, 2, 3);
const withOwnMethod: number[] = [1, 2, 3];
(withOwnMethod as any).at = (index: number) => 100 + index;
show("at replaced", elementAt(reversed, 0), elementAt(reversed, 2), elementAt(reversed, 0.5), reversed.at(1), elementAt(withOwnMethod, 2), elementAt(numbers, 0));

function headersOf(response: Response): Headers {
  return response.headers;
}
const response = new Response("body");
const headers = headersOf(response);
show("a cached getter", headers === headersOf(response), headers === response.headers, headers.get("content-type"), headersOf(new Response("other")) === headers);

function firstTwo(text: string): string {
  const [first, second] = text.split(",");
  return first + "/" + second;
}
function yearAndMonth(text: string): string {
  const match = /(\d+)-(\d+)/.exec(text);
  return match ? match[1] + "/" + match[2] + "/" + match.length : "no match";
}
function describeProperty(object: object, key: string): string {
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  return descriptor ? descriptor.value + "/" + descriptor.writable + "/" + typeof descriptor.get : "absent";
}
function joinEntries(object: Record<string, number>): string {
  let names = "", total = 0;
  for (const [name, value] of Object.entries(object)) {
    names += name;
    total += value;
  }
  return names + total;
}
show("a prefix of the result", firstTwo("a,b,c"), firstTwo("a"), firstTwo(""), yearAndMonth("on 2026-10"), yearAndMonth("never"));
show("the fields of the result", describeProperty({ a: 1 }, "a"), describeProperty({ get a() { return 1; } }, "a"), describeProperty({}, "a"), describeProperty(Object.freeze({ a: 2 }), "a"), joinEntries({ x: 1, y: 2 }), joinEntries({}));

function sumInLoop(list: number[], text: string, rounds: number): number {
  let total = 0;
  for (let i = 0; i < rounds; i++) {
    total += list.at(i % 4 === 3 ? 0.5 : i % 3) ?? 0;
    total += text.at(i % 2 === 0 ? 0 : 1e10) === undefined ? 1 : 2;
    total += Math.abs(5 - i);
    total += Math.max(i, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11);
    total += largestOfTwelveValues(i, "3");
    total += new Array(i, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11).length + Array(3).length;
    total += new Date(i).getTime();
    total += Bun.inspect(i).length;
    total += Math.PI > 3 && list[Symbol.iterator] !== undefined ? 1 : 0;
    total += headersOf(response) === headers ? 1 : 0;
    total += firstTwo(text).length + describeProperty(list, "length").length;
  }
  return total;
}
show("in a loop", sumInLoop(numbers, "a,b", 2000), sumInLoop(reversed, "a,b", 2000), sumInLoop(withOwnMethod, "", 2000));
console.log(lines.join("\n"));
