// Any that nobody wrote flows into typed functions.
export {};

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

function half(n: number): number {
  return n / 2;
}

function size(s: string): number {
  return s.length;
}

function total(list: number[]): number {
  let sum = 0;
  for (let i = 0; i < list.length; i++) sum += list[i];
  return sum;
}

function sum(p: { x: number; y: number }): number {
  return p.x + p.y;
}

console.log("honest", half(4), size("ab"), total([1, 2]), sum({ x: 1, y: 2 }));
let warm = 0;
for (let i = 0; i < 2000; i++) warm += half(i) + size("ab") + total([i]) + sum({ x: i, y: 1 });
console.log("2000 honest rounds", warm);

attempt("JSON.parse", () => [half(JSON.parse('"8"')), size(JSON.parse("[1,2]")), total(JSON.parse('"12"')), sum(JSON.parse('{"x":"1","y":2}'))]);
attempt("Object.create", () => [sum(Object.create({ x: "1", y: 2 })), sum(Object.create(null))]);
attempt("Reflect.get", () => {
  const bag: object = { n: "8", s: 5 };
  return [half(Reflect.get(bag, "n")), size(Reflect.get(bag, "s")), half(Reflect.get(bag, "missing"))];
});
attempt("Reflect.apply", () => {
  const f: Function = () => "8";
  return half(Reflect.apply(f, undefined, []));
});
attempt("Reflect.construct", () => {
  const Made: Function = class {
    x = "1";
    y = 2;
  };
  return sum(Reflect.construct(Made, []));
});
attempt("a value of type Function", () => {
  const f: Function = () => "8";
  return [half(f()), size(f())];
});
attempt("new Function", () => half(new Function("return '8'")()));
attempt("eval", () => half(eval("'8'")));
attempt("new Map()", () => {
  const m = new Map();
  m.set("n", "8");
  return [half(m.get("n")), half(m.get("missing"))];
});
attempt("new Array()", () => {
  const list = new Array();
  list.push("1", 2);
  return total(list);
});
attempt("Array(3)", () => total(Array(3)));
attempt("new Set()", () => {
  const s = new Set();
  s.add("8");
  const [first] = s;
  return typeof first;
});
attempt("Array.isArray of unknown", () => {
  const v: unknown = ["1", 2];
  return Array.isArray(v) ? total(v) : -1;
});
attempt("Object.fromEntries", () => {
  const o = Object.fromEntries([["x", "1"], ["y", 2]]);
  return sum(o as any);
});
attempt("Object.assign with four sources", () => sum(Object.assign({}, { x: 1 }, { y: 2 }, { x: "3" }, { y: "4" })));
attempt("Object.values of any", () => total(Object.values(hidden("{ a: '1', b: 2 }"))));
attempt("Object.entries of any", () => Object.entries(hidden("{ a: '8' }")).map(([, v]) => half(v as any)));
attempt("Object.getOwnPropertyDescriptor", () => half(Object.getOwnPropertyDescriptor({ n: "8" }, "n")?.value));
attempt("a regular expression's groups", () => {
  const m = /(?<a>x)|(?<b>y)/.exec("x");
  return m?.groups === undefined ? -1 : size(m.groups.b);
});
attempt("String.raw and tagged templates", () => {
  const tag = (strings: TemplateStringsArray, ...values: any[]): number => half(values[0]);
  return tag`a${"8"}b`;
});
attempt("arguments", () => {
  function f(): number {
    return half(arguments[0]);
  }
  return (f as any)("8");
});
attempt("structuredClone of any", () => sum(structuredClone(hidden("{ x: '1', y: 2 }"))));
attempt("a symbol-keyed member of any", () => half(hidden("{ [Symbol.iterator]: '8' }")[Symbol.iterator]));
attempt("globalThis by name", () => {
  (globalThis as any).looseNumber = "8";
  return half((globalThis as any).looseNumber);
});
attempt("require", () => size(require("node:path").sep.length));
attempt("import.meta", () => typeof (import.meta as any).nothing);
attempt("process.env", () => typeof process.env.NO_SUCH_VARIABLE_HERE);

const lines: string[] = [];
await Promise.reject("8").catch(reason => lines.push("catch reason " + show(half(reason))));
await Promise.reject(null).catch(reason => {
  try {
    lines.push("catch reason " + show(size(reason.message)));
  } catch (error) {
    lines.push("catch reason threw " + (error as Error).constructor.name);
  }
});
lines.push("Response.json " + show(half(await new Response('"8"').json())));
lines.push("Response.json point " + show(sum(await new Response('{"x":"1","y":2}').json())));
lines.push("Request.json " + show(total(await new Request("http://h.example/", { method: "POST", body: '"12"' }).json())));
lines.push("Bun.file-less blob json " + show(half(JSON.parse(await new Blob(['"8"']).text()))));
lines.push("dynamic import " + show(size((await import("node:path")).default.sep as any)));
for (const line of lines) console.log(line);
console.log("honest again", half(4), size("ab"), total([1, 2]), sum({ x: 1, y: 2 }));
