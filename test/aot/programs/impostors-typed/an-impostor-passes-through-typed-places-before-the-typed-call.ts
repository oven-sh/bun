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

type Step = (n: number) => number;

function total(list: number[]): number {
  let sum = 0;
  for (let i = 0; i < list.length; i++) sum += list[i];
  return sum;
}

function sum(p: Point): number {
  return p.x + p.y;
}

function code(s: string): number {
  return s.charCodeAt(0) + s.length;
}

function once(f: Step): number {
  return f(1) + 1;
}

function half(n: number): number {
  return n / 2;
}

const lists = ["[1, 2]", "[1, '2']", "[1, , 3]", "[-0]", "{ length: 2, 0: 1, 1: 2 }", "'12'", "new Uint8Array([1, 2])", "new Proxy([1, 2], {})", "null"];
const points = ["{ x: 1, y: 2 }", "{ y: 2, x: 1 }", "{ x: '1', y: 2 }", "{ x: 1 }", "{ get x() { note('get-x'); return 1; }, y: 2 }", "[1, 2]", "5", "null"];
const strings = ["'abc'", "new String('abc')", "['a']", "{ charCodeAt() { return -1; }, length: 1 }", "65", "null"];
const steps = ["n => n + 1", "n => String(n)", "class {}", "new Proxy(n => n, { apply() { return 9; } })", "{ call() { return 1; } }", "null"];
const numbers = ["3", "'3'", "3n", "-0", "{ valueOf() { note('valueOf'); return 3; } }", "undefined"];

function increment(n: number): number {
  return n + 1;
}

function honest(label: string): void {
  const list = [1, 2.5];
  const point: Point = { x: 1, y: 2 };
  const word = "abc";
  console.log(label, total([1, 2]), total(list), sum({ x: 3, y: 4 }), sum(point), code("a"), code(word), once(increment), once(n => n * 2), half(3), half(list[0]));
}

function warm(): void {
  let result = 0;
  for (let i = 0; i < 2000; i++) result += total([i, 1]) + sum({ x: i, y: 1 }) + code("k") + once(increment) + half(i);
  console.log("2000 honest rounds", result);
}

function throughALocal(text: string): number {
  const list: number[] = hidden(text);
  return total(list);
}

function throughAParameter(list: number[]): number {
  return total(list);
}

function throughTwoParameters(list: number[]): number {
  return throughAParameter(list);
}

function made(text: string): number[] {
  return hidden(text);
}

function throughAResult(text: string): number {
  return total(made(text));
}

class Holder {
  list: number[];
  constructor(list: number[]) {
    this.list = list;
  }
  total(): number {
    return total(this.list);
  }
}

function throughAnElement(text: string): number {
  const lists: number[][] = [[1], hidden(text)];
  return total(lists[1]);
}

function throughACapture(text: string): number {
  const list: number[] = hidden(text);
  const later = () => total(list);
  return later();
}

function identity<T>(value: T): T {
  return value;
}

function throughAGeneric(text: string): number {
  return total(identity<number[]>(hidden(text)));
}

function throughAPattern(text: string): number {
  const { list }: { list: number[] } = { list: hidden(text) };
  return total(list);
}

function throughADefault(list: number[] = hidden(current)): number {
  return total(list);
}

function throughACondition(text: string, flag: boolean): number {
  const list: number[] = flag ? hidden(text) : [1];
  return total(list);
}

function throughAnAssignment(text: string): number {
  let list: number[] = [1];
  total(list);
  list = hidden(text);
  return total(list);
}

function throughAUnion(text: string): number {
  const value: number[] | null = hidden(text);
  return value === null ? -1 : total(value);
}

function throughAMap(text: string): number {
  const m = new Map<string, number[]>();
  m.set("k", hidden(text));
  const list = m.get("k");
  return list === undefined ? -1 : total(list);
}

function* yields(text: string): Generator<number[]> {
  yield hidden(text);
}

function throughAYield(text: string): number {
  for (const list of yields(text)) return total(list);
  return -1;
}

let current = "[1]";

honest("honest before");
warm();

for (const text of lists) {
  current = text;
  attempt("a local " + text, () => throughALocal(text));
  attempt("a parameter " + text, () => throughAParameter(hidden(text)));
  attempt("two parameters " + text, () => throughTwoParameters(hidden(text)));
  attempt("a result " + text, () => throughAResult(text));
  attempt("a field " + text, () => new Holder(hidden(text)).total());
  attempt("an element " + text, () => throughAnElement(text));
  attempt("a captured variable " + text, () => throughACapture(text));
  attempt("a generic " + text, () => throughAGeneric(text));
  attempt("a pattern " + text, () => throughAPattern(text));
  attempt("a default " + text, () => throughADefault());
  attempt("a condition " + text, () => throughACondition(text, true));
  attempt("an assignment " + text, () => throughAnAssignment(text));
  attempt("a union " + text, () => throughAUnion(text));
  attempt("a map " + text, () => throughAMap(text));
  attempt("a yield " + text, () => throughAYield(text));
}

function pointThroughPlaces(text: string): unknown[] {
  const local: Point = hidden(text);
  const holder: { p: Point } = { p: hidden(text) };
  const list: Point[] = [hidden(text)];
  const make = (): Point => hidden(text);
  return [sum(local), sum(holder.p), sum(list[0]), sum(make()), sum(identity<Point>(hidden(text)))];
}

function numberThroughPlaces(text: string): unknown[] {
  const local: number = hidden(text);
  const holder: { n: number } = { n: hidden(text) };
  const list: number[] = [hidden(text)];
  const make = (): number => hidden(text);
  return [half(local), half(holder.n), half(list[0]), half(make()), half(identity<number>(hidden(text)))];
}

function stringThroughPlaces(text: string): unknown[] {
  const local: string = hidden(text);
  const holder: { s: string } = { s: hidden(text) };
  const list: string[] = [hidden(text)];
  const make = (): string => hidden(text);
  return [code(local), code(holder.s), code(list[0]), code(make()), code(identity<string>(hidden(text)))];
}

for (const text of points) attempt("a point through places " + text, () => pointThroughPlaces(text));
for (const text of numbers) attempt("a number through places " + text, () => numberThroughPlaces(text));
for (const text of strings) attempt("a string through places " + text, () => stringThroughPlaces(text));

honest("honest after");
