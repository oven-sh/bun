// A relation carries a kind from one place to another: "the result is parameter 0", "field f holds parameter 1", "the callback gets an element of parameter 2". If the kind at the source was only declared, not tested, the error travels with the relation. Nothing may throw because of a type and nothing may be taken for what it is not: the answers are those of plain Bun.
const lie = <T,>(value: unknown): T => value as T;
function identity(x: number): number {
  return x;
}
function twice(x: number): number {
  return identity(identity(x));
}
function plusOne(x: number): number {
  return identity(x) + 1;
}
function lengthOf(s: string): number {
  return s.length;
}
function lengthThrough(s: string): number {
  return lengthOf(echo(s));
}
function echo(s: string): string {
  return s;
}
class Cell {
  constructor(public value: number) {}
  get(): number {
    return this.value;
  }
  doubled(): number {
    return this.value * 2;
  }
}
function cellOf(x: number): Cell {
  return new Cell(x);
}
function throughACell(x: number): number {
  return cellOf(x).get();
}
function doubledThroughACell(x: number): number {
  return cellOf(x).doubled();
}
function mapAll(list: number[], f: (n: number) => number): number[] {
  const out: number[] = [];
  for (let i = 0; i < list.length; i++) out.push(f(list[i]));
  return out;
}
interface Named {
  name: string;
}
function nameOf(n: Named): string {
  return n.name;
}
function nameThrough(n: Named): string {
  return nameOf(pass(n));
}
function pass<T>(x: T): T {
  return x;
}
function upper(n: Named): string {
  return nameOf(n).toUpperCase();
}
function pick(flag: boolean, a: number, b: number): number {
  return flag ? a : b;
}
function sumOf(a: number, b: number): number {
  return a + b;
}
function compare(a: number, b: number): boolean {
  return a < b;
}
let warm = 0;
for (let i = 0; i < 2000; i++) {
  warm += twice(i) + plusOne(i) + lengthThrough("s" + i) + throughACell(i) + doubledThroughACell(i) + mapAll([i, i], plusOne)[1] + nameThrough({ name: "n" }).length + upper({ name: "n" }).length + pick(i % 2 === 0, i, 1) + sumOf(i, 1) + (compare(i, 5) ? 1 : 0);
}
console.log(warm);
const show = (f: () => unknown): string => {
  try {
    const x = f();
    return typeof x + ":" + (typeof x === "object" ? JSON.stringify(x) : String(x));
  } catch (error) {
    return (error as Error).constructor.name;
  }
};
const strangers: unknown[] = ["text", "7", 1.5, NaN, -0, null, undefined, true, 10n, { valueOf: () => 3 }, [4], Symbol.iterator, () => 1];
for (const s of strangers) {
  console.log(
    [
      show(() => twice(lie(s))),
      show(() => plusOne(lie(s))),
      show(() => throughACell(lie(s))),
      show(() => doubledThroughACell(lie(s))),
      show(() => mapAll(lie([s]), plusOne)[0]),
      show(() => mapAll([1], lie(() => s))[0]),
      show(() => pick(true, lie(s), 1)),
      show(() => sumOf(lie(s), 1)),
      show(() => sumOf(1, lie(s))),
      show(() => compare(lie(s), 2)),
      show(() => lengthThrough(lie(s))),
      show(() => nameThrough(lie(s))),
      show(() => upper(lie(s))),
      show(() => upper({ name: lie(s) })),
    ].join(" "),
  );
}

// Too few and too many arguments; holes; array-likes.
console.log(show(() => lie<() => number>(twice)()), show(() => lie<() => number>(plusOne)()), show(() => lie<(a: number) => number>(sumOf)(1)), show(() => lie<(...a: number[]) => number>(sumOf)(1, 2, 3)), show(() => mapAll(lie([1, , 3]), plusOne)), show(() => mapAll(lie({ length: 2, 0: 5 }), plusOne)), show(() => mapAll(lie("12"), plusOne)));

// An object of another class, a literal, a Proxy, a null prototype where an instance was declared.
class Impostor {
  value = "not a number";
  get(): string {
    return "impostor's get";
  }
}
function readValue(c: Cell): number {
  return c.value;
}
function callGet(c: Cell): number {
  return c.get();
}
function readThrough(c: Cell): number {
  return readValue(pass(c));
}
for (let i = 0; i < 1000; i++) warm += readValue(new Cell(i)) + callGet(new Cell(i)) + readThrough(new Cell(i));
for (const c of [new Impostor(), { value: "literal", get: () => "literal's get" }, new Proxy(new Cell(5), {}), Object.assign(Object.create(null), { value: 6 }), Object.create(new Cell(7)), { value: 8 }, 9, "ten"]) {
  console.log(show(() => readValue(lie(c))), show(() => callGet(lie(c))), show(() => readThrough(lie(c))));
}

// The field was set from a parameter of the declared kind, and then written by code that knows no types.
const cell = new Cell(1);
const untyped: any = cell;
untyped.value = "written through any";
console.log(show(() => cell.get()), show(() => cell.doubled()), show(() => readThrough(cell)));
delete untyped.value;
console.log(show(() => cell.get()), show(() => cell.doubled()));
Object.defineProperty(cell, "value", { get: () => "from an accessor", configurable: true });
console.log(show(() => cell.get()), show(() => readValue(cell)));

// JSON and other outside data as declared types.
const parsed = JSON.parse('{"name":5,"list":["a",null,2],"cell":{"value":"v"}}') as { name: string; list: number[]; cell: Cell };
console.log(show(() => nameThrough(parsed)), show(() => upper(parsed)), show(() => mapAll(parsed.list, plusOne)), show(() => readThrough(parsed.cell)), show(() => callGet(parsed.cell)));
