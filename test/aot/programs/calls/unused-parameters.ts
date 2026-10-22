// A parameter with a written type is tested on entry whether or not the body uses it: functions, arrow functions, methods, static methods, setters, generators and async functions, each called through `any` with every kind of value. undefined and null pass every type.
type Point = { x: number; y: number };
function none(a: number, p: Point, s: string): number {
  return 7;
}
function last(a: number, p: Point, s: string): string {
  return s + "!";
}
function first(a: number, p: Point, s: string): number {
  return a * 2;
}
function middle(flag: boolean, a: number, list: string[], b: number): number {
  return a - b;
}
const arrow = (ignored: Point, n: number) => n + 0.5;
class Shape {
  sides = 4;
  area(scale: number, unit: string): string {
    return this.sides + unit;
  }
  static of(kind: string, sides: number): number {
    return sides;
  }
  set width(value: number) {
    this.sides++;
  }
}
async function later(ignored: Point, n: number): Promise<number> {
  await null;
  return n;
}
function* each(ignored: string, n: number): Generator<number> {
  yield n;
  yield n + 1;
}
function defaulted(a: number = 3, b: string = "b"): string {
  return b;
}
function rest(a: number, ...others: number[]): number {
  return 1;
}
function closes(a: number, b: number): () => number {
  return () => b;
}
const table: Record<string, Function> = { none, last, first, middle, arrow, later, each, defaulted, rest, closes, of: Shape.of };
const misfits: unknown[] = [undefined, null, true, 1, 0.5, "text", {}, [], () => 1, Symbol.iterator, 1n];
const show = (value: unknown) => (typeof value === "symbol" || typeof value === "bigint" || typeof value === "function" ? typeof value : JSON.stringify(value));
function attempt(label: string, call: () => unknown) {
  try {
    console.log(label, show(call()));
  } catch (error) {
    console.log(label, "throws", (error as Error).constructor.name);
  }
}
const names = Object.keys(table);
const point: Point = { x: 1, y: 2 };
for (const misfit of misfits) {
  const label = show(misfit);
  for (const name of names) {
    if (name === "none") attempt(`none ${label}`, () => table[name](misfit, misfit, misfit));
    if (name === "last") attempt(`last ${label}`, () => table[name](misfit, misfit, "s"));
    if (name === "first") attempt(`first ${label}`, () => table[name](21, misfit, misfit));
    if (name === "middle") attempt(`middle ${label}`, () => table[name](misfit, 5, misfit, 3));
    if (name === "arrow") attempt(`arrow ${label}`, () => table[name](misfit, 1));
    if (name === "of") attempt(`of ${label}`, () => table[name](misfit, 6));
    if (name === "each") attempt(`each ${label}`, () => [...table[name](misfit, 1)]);
    if (name === "closes") attempt(`closes ${label}`, () => table[name](misfit, 9)());
  }
  const shape: any = new Shape();
  attempt(`area ${label}`, () => shape.area(misfit, "cm"));
  attempt(`width ${label}`, () => ((shape.width = misfit), shape.sides));
}
let sum = 0;
for (let i = 0; i < 100; i++) sum += none(i + 0.5, point, "s") + first(i, point, "s") + middle(i > 50, i, [], 1) + arrow(point, i) + Shape.of("square", i) + last(i / 3, point, "s").length;
console.log(sum);
for (const misfit of misfits) {
  try {
    console.log("later", show(misfit), await table[names.find(name => name === "later")!](misfit, 2));
  } catch (error) {
    console.log("later", show(misfit), "rejects", (error as Error).constructor.name);
  }
}
