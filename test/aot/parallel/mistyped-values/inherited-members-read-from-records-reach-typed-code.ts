// An index read of a Record<string, T> finds the members of Object.prototype, so what it answers is not always a T.
// Each such value goes into functions that declare a T, between calls with honest values.
class Point {
  x: number = 1;
  label: string = "p";
  double(): number {
    return this.x * 2;
  }
}

function show(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "function") return "function " + value.name;
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "object") return "object " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function attempt(label: string, run: () => unknown): void {
  let line: string;
  try {
    line = show(run());
  } catch (error) {
    line = "throws " + (error as Error).name;
  }
  console.log(label, "=", line);
}

function numbers(v: number): unknown[] {
  return [v + 1, v * 2, v | 0, v < 3, -v, `<${v}>`, v ? 1 : 0, typeof v, [10, 20][v]];
}
function strings(v: string): unknown[] {
  return [v.length, v + "x", v < "b", v === "a", `<${v}>`, v ? 1 : 0, typeof v, v[0]];
}
function booleans(v: boolean): unknown[] {
  return [!v, v && 1, v ? "y" : "n", v === true, v === false, `<${v}>`, Number(v), typeof v];
}
function bigints(v: bigint): unknown[] {
  return [v + 1n, v * 2n, v < 3n, v === 1n, `<${v}>`, v ? 1 : 0, typeof v];
}
function points(v: Point): unknown[] {
  return [v.x + 1, v.label, v instanceof Point, "x" in v, typeof v, v.double()];
}
function lists(v: number[]): unknown[] {
  return [v.length, v[0] + 1, Array.isArray(v), typeof v, v.indexOf(2), [...v]];
}
function callbacks(v: () => number): unknown[] {
  return [v.length, v.name, typeof v, v() + 1];
}

const names = ["toString", "constructor", "valueOf", "hasOwnProperty", "__proto__", "isPrototypeOf", "none"];

function each<T>(kind: string, record: Record<string, T>, use: (v: T) => unknown[]): void {
  attempt(kind + " honest", () => use(record["own"]).map(show).join(" | "));
  for (const name of names) attempt(kind + " " + name, () => use(record[name]).map(show).join(" | "));
  attempt(kind + " honest again", () => use(record["own"]).map(show).join(" | "));
}

each<number>("number", { own: 1 }, numbers);
each<string>("string", { own: "a" }, strings);
each<boolean>("boolean", { own: true }, booleans);
each<bigint>("bigint", { own: 1n }, bigints);
each<Point>("class", { own: new Point() }, points);
each<number[]>("array", { own: [1, 2] }, lists);
each<() => number>("function", { own: () => 1 }, callbacks);

const flags: Record<string, boolean> = { own: false };
const counts: Record<string, number> = { own: 2 };
const texts: Record<string, string> = { own: "b" };
attempt("boolean by a constant name", () => booleans(flags["toString"]).map(show).join(" | "));
attempt("number by a constant name", () => numbers(counts["valueOf"]).map(show).join(" | "));
attempt("string by a constant name", () => strings(texts["constructor"]).map(show).join(" | "));
attempt("boolean by __proto__", () => booleans(flags["__proto__"]).map(show).join(" | "));
attempt("honest at the end", () => [booleans(flags["own"]), numbers(counts["own"]), strings(texts["own"])].flat().map(show).join(" | "));
