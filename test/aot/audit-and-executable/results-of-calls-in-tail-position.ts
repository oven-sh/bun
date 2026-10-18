// The result of a call in tail position is checked, and converted by an `as`, where it is received as a type, not in the function that returns it. `bun run --aot` says the same as the executable.
function attempt(what: () => unknown): string { try { const got = what(); return typeof got + " " + String(got); } catch (e) { return (e as Error).constructor.name; } }
const g: any = globalThis;
function num(f: (x: number) => number, x: number): number { return f(x); }
function either(f: (x: number) => number, h: (x: number) => number, x: number): number { return x > 0 ? f(x) : h(x); }
function orElse(f: (x: number) => number, x: number): number { return x > 100 ? x : f(x); }
function viaAs(f: () => unknown): number { return f() as number; }
function viaDirect(x: number): number { return loose(x) as number; }
function loose(x: number): unknown { return x > 0 ? "loose" + x : x; }
function twice(f: (x: number) => number, x: number): number { return num(f, x); }
class Box {
  constructor(public f: (x: number) => number) {}
  run(x: number): number { return this.f(x); }
  static of(f: (x: number) => number, x: number): number { return new Box(f).run(x); }
}
interface Row { id: number }
function row(f: () => Row): Row { return f(); }
g.keep = [num, either, orElse, viaAs, viaDirect, twice, row];
const bad: any = (x: number) => "s" + x;
const good = (x: number) => x + 1;
const list: any = () => [1];
const text: any = () => "4";
const rows: [string, () => unknown][] = [
  ["by value, to whoever takes anything", () => num(bad, 5)],
  ["by value, into a typed variable", () => { const r: number = num(bad, 5); return r; }],
  ["by value, used as a number", () => num(bad, 5) + 1],
  ["by value, what the type says", () => num(good, 5) + 1],
  ["one of two", () => either(good, bad, -1)],
  ["one of two, used", () => either(good, bad, -1) + 1],
  ["one of two, the other", () => either(good, bad, 1) + 1],
  ["its own result or a call's", () => orElse(bad, 5)],
  ["its own result or a call's, used", () => orElse(bad, 5) + 1],
  ["its own result", () => orElse(bad, 500) + 1],
  ["through two functions", () => twice(bad, 5)],
  ["through two functions, used", () => twice(bad, 5) + 1],
  ["as, to whoever takes anything", () => viaAs(list)],
  ["as, a text", () => viaAs(text)],
  ["as, a text, used", () => viaAs(text) + 1],
  ["as on a known function", () => viaDirect(1)],
  ["as on a known function, used", () => viaDirect(1) + 1],
  ["as on a known function, what the type says", () => viaDirect(-1) + 1],
  ["a method", () => new Box(bad).run(5)],
  ["a method, used", () => new Box(bad).run(5) + 1],
  ["a static method", () => Box.of(bad, 5)],
  ["a static method, used", () => Box.of(bad, 5) + 1],
  ["an object type", () => row(text)],
  ["an object type, read", () => row(text).id],
  ["a comparator", () => [1, 2].sort(() => list() as number).join()],
  ["a mapper", () => [1, 2].map(() => text() as number).map(x => typeof x).join()],
  ["a mapper by value", () => [1, 2].map(x => num(bad, x)).map(x => typeof x).join()],
  ["taken as a value", () => (g.keep[0] as any)(bad, 5)],
  ["taken as a value, as", () => (g.keep[3] as any)(list)],
];
for (let round = 0; round < 3; round++) for (const [name, what] of rows) console.log(round, name + ": " + attempt(what));
