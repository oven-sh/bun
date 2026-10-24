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

interface Point {
  x: number;
  y: number;
}

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

function half(n: number): number {
  return n / 2;
}

function compare(a: number, b: number): number {
  return a - b;
}

function add(a: number, b: number): number {
  return a + b;
}

const tools = { total, sum, code, half };
const list = [half, (n: number) => n + 1];
const byName = new Map<string, (n: number) => number>([["half", half]]);

class Kit {
  scale = 2;
  half(n: number): number {
    return (n / 2) * this.scale;
  }
}

function honest(label: string): void {
  console.log(label, total([1, 2]), sum({ x: 1, y: 2 }), code("a"), half(3), show([1, 2].map(half)), show([2, 1].sort(compare)), [1, 2].reduce(add, 0), tools.half(4), list[0](4), byName.get("half")?.(4), new Kit().half(4));
}

honest("honest before");
let warm = 0;
for (let i = 0; i < 2000; i++) warm += total([i]) + sum({ x: i, y: 1 }) + code("k") + half(i) + tools.half(i) + list[i & 1](i) + new Kit().half(i);
console.log("2000 honest rounds", warm);

const mixed: any[] = [3, "3", -0, null, undefined, { valueOf: () => 4 }, [8], true];
const builtName: string = ["ha", "lf"].join("");
const parsedName: string = JSON.parse('"half"');

attempt("map", () => mixed.map(half));
attempt("map with a bigint", () => ([1, 2n] as any[]).map(half));
attempt("forEach", () => {
  const seen: unknown[] = [];
  mixed.forEach(v => seen.push(half(v)));
  return seen;
});
attempt("reduce", () => ([1, "2", 3] as any[]).reduce(add, 0));
attempt("sort", () => (["10", "9", 1] as any[]).sort(compare));
attempt("Array.from", () => Array.from({ length: 2, 0: "4" } as any, half));
attempt("Array.from a string", () => Array.from("48" as any, half));
attempt("map total", () => ([[1, 2], "12", { length: 1, 0: 5 }, new Uint8Array([9])] as any[]).map(total));
attempt("map sum", () => ([{ x: 1, y: 2 }, { y: "2", x: 1 }, [1], "xy", 5] as any[]).map(sum));
attempt("map code", () => (["abc", new String("b"), ["c"]] as any[]).map(code));
attempt("map code with a number", () => (["abc", 5] as any[]).map(code));
attempt("Reflect.apply", () => Reflect.apply(half, undefined, ["8"] as any));
attempt("call, apply and bind", () => [(half as any).call(undefined, "8"), (half as any).apply(undefined, ["8"]), (half as any).bind(undefined, "8")(), (total as any).call(undefined, "12"), (sum as any).apply(undefined, [{ x: "1", y: 2 }])]);
attempt("JSON.parse with a reviver", () => JSON.stringify(JSON.parse('{"a":"8","b":4}', (key: string, value: number) => (key === "" ? value : half(value)))));
attempt("replace", () => "a1".replace(/\d/, code as any));
attempt("a computed name", () => [(tools as any)[builtName]("8"), (tools as any)[parsedName]("8"), (new Kit() as any)[builtName]("8")]);
attempt("a computed name: total", () => (tools as any)[["to", "tal"].join("")]("12"));
attempt("entries", () => Object.entries(tools).map(([key, f]) => key + ":" + show((f as any)("12"))));
attempt("an element of a list of functions", () => [list[0]("8" as any), list[1]("8" as any)]);
attempt("a value of a map of functions", () => byName.get(builtName)?.("8" as any));
attempt("valueOf is the function", () => +({ valueOf: half } as any));
attempt("a getter calls it", () => ({ get v() { return half("8" as any); } }).v);

const lines: string[] = [];
Promise.resolve("8" as any)
  .then(half)
  .then(v => lines.push("then " + show(v)))
  .then(() => Promise.reject({ x: "1", y: 2 }))
  .catch(sum)
  .then(v => lines.push("catch " + show(v)))
  .then(() => {
    for (const line of lines) console.log(line);
    honest("honest after");
  });
