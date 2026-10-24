// `as` behind a call of a built-in's method in tail position, received by typed code through methods and functions.
class Store {
  m = new Map<string, number>();
  set = new Set<number>([1]);
  get(k: string): number { return this.m.get(k) as number; }
  first(xs: number[]): number { return xs.find(x => x > 5) as number; }
  at(s: string): number { return s.codePointAt(9) as number; }
  last(xs: number[]): number { return xs.pop() as number; }
  text(xs: string[]): string { return xs.shift() as string; }
  own(k: string): number { return this.lookup(k) as number; }
  lookup(k: string): number | undefined { return this.m.get(k); }
}
function get(m: Map<string, number>, k: string): number { return m.get(k) as number; }
function match(s: string): string { return (s.match(/x/) as RegExpMatchArray)[0]; }
const g: any = globalThis;
g.keep = [get];
const s = new Store();
function attempt(what: () => unknown): string { try { const got = what(); return typeof got + " " + String(got); } catch (e) { return (e as Error).constructor.name; } }
const rows: [string, () => unknown][] = [
  ["a Map, used", () => s.get("x") + 1],
  ["a Map", () => s.get("x")],
  ["find, used", () => s.first([1]) + 1],
  ["find", () => s.first([1])],
  ["codePointAt, used", () => s.at("a") + 1],
  ["pop, used", () => s.last([]) + 1],
  ["shift, used", () => s.text([]) + "!"],
  ["a method of the program, used", () => s.own("x") + 1],
  ["a method of the program", () => s.own("x")],
  ["a function, used", () => get(s.m, "x") + 1],
  ["a function", () => get(s.m, "x")],
  ["a function as a value", () => g.keep[0](s.m, "x")],
];
for (let round = 0; round < 2; round++) for (const [name, what] of rows) console.log(round, name + ": " + attempt(what));
