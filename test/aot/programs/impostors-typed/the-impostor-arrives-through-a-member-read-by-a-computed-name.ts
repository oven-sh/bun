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

const tools = { total, sum, code, once, half };

class Kit {
  scale = 2;
  total(list: number[]): number {
    return total(list) * this.scale;
  }
  sum(p: Point): number {
    return (p.x + p.y) * this.scale;
  }
  code(s: string): number {
    return s.charCodeAt(0) * this.scale;
  }
  once(f: Step): number {
    return f(1) * this.scale;
  }
  half(n: number): number {
    return (n / 2) * this.scale;
  }
  static half(n: number): number {
    return n / 2;
  }
}

const kit = new Kit();
const table: [string, string[]][] = [
  ["total", lists],
  ["sum", points],
  ["code", strings],
  ["once", steps],
  ["half", numbers],
];

honest("honest before");
warm();
console.log("honest members", tools.total([1]), tools.sum({ x: 1, y: 1 }), tools.code("a"), tools.once(increment), tools.half(4), kit.total([1]), kit.sum({ x: 1, y: 1 }), kit.code("a"), kit.once(increment), kit.half(4), Kit.half(4));
console.log("honest brackets", tools["total"]([1]), kit["half"](4), Kit["half"](4));

for (const [name, texts] of table) {
  const built: string = hidden("'" + name.slice(0, 2) + "' + '" + name.slice(2) + "'");
  for (const text of texts) {
    attempt("tools[" + name + "] " + text, () => (tools as any)[built](hidden(text)));
    attempt("kit[" + name + "] " + text, () => (kit as any)[built](hidden(text)));
    attempt("prototype[" + name + "] " + text, () => (Kit.prototype as any)[built](hidden(text)));
    attempt("Reflect.get " + name + " " + text, () => Reflect.get(tools, built)(hidden(text)));
    attempt("entries " + name + " " + text, () => {
      for (const [key, f] of Object.entries(tools)) if (key === built) return (f as any)(hidden(text));
    });
  }
}

const key = { toString: () => (log.push("key"), "half") };
attempt("a key with toString", () => (tools as any)[key as any](hidden("'8'")));
attempt("a symbol key", () => (tools as any)[Symbol.iterator](hidden("'8'")));
attempt("a missing key", () => (tools as any)[hidden("'nothing'")](hidden("'8'")));
attempt("an inherited key", () => (tools as any)[hidden("'valueOf'")]() === tools);
attempt("static by name", () => (Kit as any)[hidden("'half'")](hidden("'8'")));
attempt("optional call by name", () => (tools as any)[hidden("'nothing'")]?.(hidden("'8'")));
attempt("destructured by name", () => {
  const { [hidden("'half'") as "half"]: picked } = tools;
  return picked(hidden("'8'"));
});
attempt("keyof", () => {
  const name = hidden("'half'") as "half" | "code";
  const picked = tools[name] as (v: any) => number;
  return picked(hidden("'8'"));
});

honest("honest after");
