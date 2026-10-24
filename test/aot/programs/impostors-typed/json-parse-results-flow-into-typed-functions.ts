function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (value === null || value === undefined) return String(value);
  if (typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  return typeof value;
}

const log: string[] = [];

function attempt(label: string, run: () => unknown): void {
  log.length = 0;
  try {
    console.log(label, "->", show(run()), log.join(" "));
  } catch (error) {
    console.log(label, "threw", error instanceof Error ? error.constructor.name : typeof error, log.join(" "));
  }
}

(globalThis as any).note = (text: string) => log.push(text);
const hidden = (text: string): any => (0, eval)("(" + text + ")");

interface Point {
  x: number;
  y: number;
}

interface Order {
  id: number;
  name: string;
  tags: string[];
  at: Point;
  note?: string;
}

function sum(p: Point): number {
  return p.x + p.y;
}

function weigh(o: Order): number {
  return o.id + o.name.length + o.tags.length + sum(o.at) + (o.note === undefined ? 0 : o.note.length);
}

function parsePoint(text: string): Point {
  return JSON.parse(text);
}

function parseOrder(text: string): Order {
  const order: Order = JSON.parse(text);
  return order;
}

function parseNumbers(text: string): number[] {
  return JSON.parse(text) as number[];
}

function total(list: number[]): number {
  let result = 0;
  for (let i = 0; i < list.length; i++) result += list[i];
  return result;
}

function honest(label: string): void {
  console.log(label, sum(parsePoint('{"x":1,"y":2}')), weigh(parseOrder('{"id":1,"name":"ab","tags":["t"],"at":{"x":1,"y":2}}')), total(parseNumbers("[1,2,3]")), sum({ x: 1, y: 2 }), total([1]));
}

honest("honest before");
let warm = 0;
for (let i = 0; i < 2000; i++) warm += sum(parsePoint('{"x":' + i + ',"y":2}')) + total(parseNumbers("[1," + i + "]"));
console.log("2000 honest rounds", warm);

const points = [
  '{"x":1,"y":2}',
  '{"y":2,"x":1}',
  '{"x":1,"y":2,"z":3}',
  '{"a":0,"x":1,"y":2}',
  '{"x":1}',
  "{}",
  '{"x":"1","y":2}',
  '{"x":1,"y":"2"}',
  '{"x":null,"y":2}',
  '{"x":true,"y":2}',
  '{"x":[1],"y":2}',
  '{"x":{"v":1},"y":2}',
  '{"x":1.5,"y":-0}',
  '{"x":-0,"y":-0}',
  '{"x":1e400,"y":1}',
  '{"x":2147483648,"y":-2147483649}',
  '{"x":1,"x":"twice","y":2}',
  '{"x":1,"y":2,"__proto__":{"x":9}}',
  '{"__proto__":{"x":9,"y":9}}',
  '{"x":1,"y":2,"0":0,"1":1}',
  '{"X":1,"Y":2}',
  "[1,2]",
  '"xy"',
  "5",
  "null",
  "true",
  "",
  "{",
];

for (const text of points) {
  attempt("point " + text + " sum", () => sum(parsePoint(text)));
  attempt("point " + text + " keys", () => Object.keys(parsePoint(text)).join());
  attempt("point " + text + " again", () => JSON.stringify(parsePoint(text)));
  attempt("point " + text + " typed local", () => {
    const p: Point = JSON.parse(text);
    return p.x - p.y;
  });
}

const orders = [
  '{"id":1,"name":"ab","tags":["t"],"at":{"x":1,"y":2},"note":"n"}',
  '{"id":"1","name":"ab","tags":["t"],"at":{"x":1,"y":2}}',
  '{"id":1,"name":5,"tags":["t"],"at":{"x":1,"y":2}}',
  '{"id":1,"name":null,"tags":["t"],"at":{"x":1,"y":2}}',
  '{"id":1,"name":"ab","tags":"tt","at":{"x":1,"y":2}}',
  '{"id":1,"name":"ab","tags":{"length":7},"at":{"x":1,"y":2}}',
  '{"id":1,"name":"ab","tags":null,"at":{"x":1,"y":2}}',
  '{"id":1,"name":"ab","tags":[],"at":null}',
  '{"id":1,"name":"ab","tags":[],"at":{"x":"1","y":2}}',
  '{"id":1,"name":"ab","tags":[],"at":[1,2]}',
  '{"id":1,"name":"ab","tags":[],"at":{"x":1,"y":2},"note":null}',
  '{"id":1,"name":"ab","tags":[],"at":{"x":1,"y":2},"note":5}',
  '{"at":{"y":2,"x":1},"tags":[],"name":"ab","id":1}',
];
for (const text of orders) attempt("order " + text, () => weigh(parseOrder(text)));

for (const text of ["[1,2,3]", '[1,"2",3]', "[1,null,3]", "[1.5,-0]", "[[1],[2]]", "[]", '{"length":2,"0":1,"1":2}', '"12"', "null", "5", "[1e400]", "[true]", "[2147483647,1]"]) {
  attempt("numbers " + text + " total", () => total(parseNumbers(text)));
  attempt("numbers " + text + " map", () => parseNumbers(text).map(v => v + 1));
}

attempt("a reviver swaps the kinds", () => sum(JSON.parse('{"x":1,"y":2}', (key, value) => (key === "x" ? String(value) : value))));
attempt("a reviver drops a member", () => sum(JSON.parse('{"x":1,"y":2}', (key, value) => (key === "y" ? undefined : value))));
attempt("a reviver replaces the whole", () => sum(JSON.parse('{"x":1,"y":2}', (key, value) => (key === "" ? "whole" : value))));
attempt("a reviver adds a getter", () => sum(JSON.parse('{"x":1,"y":2}', function (this: any, key, value) {
  if (key === "x") Object.defineProperty(this, "y", { get: () => (log.push("get-y"), 40), configurable: true, enumerable: true });
  return value;
})));

honest("honest after");
