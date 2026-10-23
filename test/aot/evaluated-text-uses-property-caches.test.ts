import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { run as runCommand } from "./harness/run";
import { beforeAll, describe, eachRow, gap, test } from "./supported";

// Text that a compiled program evaluates runs in the interpreter, which answers accesses to compiled objects from caches and
// allocates the objects of literals itself. What it does by itself does not enter the run time, so the counters of the interpreter's
// slow paths do not grow with the number of turns. Beside each such operation stands one that has to. Calls and operators have no
// counter: the bodies with them are held to the other five.
const program = `
  declare const process: { argv: string[] };
  declare const console: { log(...values: any[]): void };
  class Base { method() { return 1; } get computed() { return 1; } set computed(v: number) {} }
  class Item extends Base {
    whole = 1; fraction = 1.5; flag = true; text = "text"; link: Item | null = null; maybe?: number = undefined;
    anything: unknown = 1; either: number | string = 1; list = [1];
  }
  function add(a: any, b: any) { return a + b; }
  function subtract(a: any, b: any) { return a - b; }
  const [, , body, turns] = process.argv;
  const item = new Item(), other = new Item(), literal = { a: 1, b: "two" };
  item.link = other;
  const hidden: any = new Item();
  Object.defineProperty(hidden, "unseen", { value: 1, enumerable: false });
  const removed: any = new Item();
  delete removed.whole;
  const frozen = Object.freeze(new Item());
  const parsed = JSON.parse('{"a":1}');
  const proxy = new Proxy(new Item(), {});
  const many: ((a: any, b: any) => any)[] = [];
  for (let i = 0; i < 40; i++) many.push((a, b) => a + b + i);
  class Wide {
    f0 = 0; f1 = 1; f2 = 2; f3 = 3; f4 = 4; f5 = 5; f6 = 6; f7 = 7; f8 = 8; f9 = 9; f10 = 10; f11 = 11; f12 = 12; f13 = 13; f14 = 14; f15 = 15;
    f16 = 16; f17 = 17; f18 = 18; f19 = 19; f20 = 20; f21 = 21; f22 = 22; f23 = 23; f24 = 24; f25 = 25; f26 = 26; f27 = 27; f28 = 28; f29 = 29;
    f30 = 30; f31 = 31; f32 = 32; f33 = 33; f34 = 34; f35 = 35; f36 = 36; f37 = 37; f38 = 38; f39 = 39;
    s0 = "a"; s1 = "b"; s2 = "c"; s3 = "d"; s4 = "e"; s5 = "f"; s6 = "g"; s7 = "h"; s8 = "i"; s9 = "j"; s10 = "k"; s11 = "l"; s12 = "m"; s13 = "n";
    o0: Item | null = null; o1: Item | null = null; o2: Item | null = null; o3: Item | null = null; o4: Item | null = null; o5: Item | null = null;
  }
  const wide = new Wide();
  const tools = { size: 1, measure() { return this.size; } };
  const heir: any = { __proto__: tools, size: 2 };
  const run = new Function("item", "other", "literal", "hidden", "removed", "frozen", "parsed", "proxy", "add", "subtract", "many", "wide", "tools", "heir", "Item", "Base", "key", "turns",
    "let t = 0; for (let i = 0; i < turns; i++) { " + body + " } return t;");
  console.log(typeof run(item, other, literal, hidden, removed, frozen, parsed, proxy, add, subtract, many, wide, tools, heir, Item, Base, "whole", Number(turns)));
`;

type Counter = "Read" | "Store" | "Presence" | "Allocation" | "Branch";
const counters: Counter[] = ["Read", "Store", "Presence", "Allocation", "Branch"];

let directory: ReturnType<typeof tempDir>;
let executable: string;

async function run(cmd: string[], env: Record<string, string | undefined>) {
  const { stdout, stderr, exitCode } = await runCommand(cmd, String(directory), env);
  return { stdout, stderr, exitCode };
}

async function count(body: string, turns: number) {
  const path = join(String(directory), "counts" + Math.random().toString(36).slice(2));
  const env = { ...bunEnv, BUN_DESTRUCT_VM_ON_EXIT: "1", BUN_JSC_aotCountsPath: path };
  expect(await run([executable, body, String(turns)], env)).toEqual({ stdout: "number\n", stderr: "", exitCode: 0 });
  const counts = new Map(
    readFileSync(path, "utf8")
      .split("\n")
      .map(line => line.split("\t").reverse() as [string, string]),
  );
  return Object.fromEntries(
    counters.map(counter => [counter, Number(counts.get(`counter:Interpreter${counter}SlowPaths`))]),
  );
}

// How many slow paths of each kind one more turn takes.
async function slowPathsPerTurn(body: string) {
  const [few, many] = await Promise.all([count(body, 200), count(body, 1200)]);
  return Object.fromEntries(
    counters.map(counter => [counter, Math.round((many[counter]! - few[counter]!) / 100) / 10]),
  );
}

const none = { Read: 0, Store: 0, Presence: 0, Allocation: 0, Branch: 0 };

beforeAll(async () => {
  directory = tempDir("aot-evaluated-text-uses-property-caches", { "main.ts": program });
  executable = join(String(directory), "main" + (isWindows ? ".exe" : ""));
  const built = await run([bunExe(), "build", "--compile", "--aot", "main.ts", "--outfile", executable], bunEnv);
  expect(built.exitCode ? built.stderr : "built").toBe("built");
}, 240_000);

describe.concurrent("no slow path", () => {
  const storeEntersTheRunTime =
    "a store from evaluated text into a field of a typed object enters the run time in each turn";
  eachRow([
    [
      "reads of fields",
      "t += item.whole + item.fraction + item.either + literal.a; if (item.flag && item.link && item.text && item.list && item.anything) t++;",
    ],
    ["reads of a field that holds undefined or null", "if (item.maybe || other.link) t++;"],
    ["a read of a property that is no field", "t += hidden.unseen;"],
    ["reads of what the prototypes have and lack", "if (item.method && !item.missing) t++;"],
    ["reads at a site with several receivers", "t += (i & 1 ? item : literal.a ? hidden : other).whole;"],
    [
      "reads of the fields of an object with more fields than its cell holds",
      "t += wide.f0 + wide.f1 + wide.f2 + wide.f3 + wide.f4 + wide.f5 + wide.f6 + wide.f7 + wide.f8 + wide.f9 + wide.f10 + wide.f11 + wide.f12 + wide.f13 + wide.f14 + wide.f15 + wide.f16 + wide.f17 + wide.f18 + wide.f19 + wide.f20 + wide.f21 + wide.f22 + wide.f23 + wide.f24 + wide.f25 + wide.f26 + wide.f27 + wide.f28 + wide.f29 + wide.f30 + wide.f31 + wide.f32 + wide.f33 + wide.f34 + wide.f35 + wide.f36 + wide.f37 + wide.f38 + wide.f39; if (wide.s0 && wide.s13 && !wide.o0 && !wide.o5) t++;",
    ],
    [
      "stores to the fields of such an object",
      "wide.f0 = i; wide.f1 = i; wide.f2 = i; wide.f3 = i; wide.f4 = i; wide.f5 = i; wide.f6 = i; wide.f7 = i; wide.f8 = i; wide.f9 = i; wide.f10 = i; wide.f11 = i; wide.f12 = i; wide.f13 = i; wide.f14 = i; wide.f15 = i; wide.f16 = i; wide.f17 = i; wide.f18 = i; wide.f19 = i; wide.f20 = i; wide.f21 = i; wide.f22 = i; wide.f23 = i; wide.f24 = i; wide.f25 = i; wide.f26 = i; wide.f27 = i; wide.f28 = i; wide.f29 = i; wide.f30 = i; wide.f31 = i; wide.f32 = i; wide.f33 = i; wide.f34 = i; wide.f35 = i; wide.f36 = i; wide.f37 = i; wide.f38 = i; wide.f39 = i; wide.s0 = key; wide.s13 = key; wide.o0 = null; wide.o5 = null;",
    ],
    [
      "in with such an object",
      'if ("f0" in wide && "f3" in wide && "f6" in wide && "f9" in wide && "f12" in wide && "f15" in wide && "f18" in wide && "f21" in wide && "f24" in wide && "f27" in wide && "f30" in wide && "f33" in wide && "f36" in wide && "f39" in wide) t++;',
    ],
    [
      "in",
      'if ("whole" in item && "method" in item && "unseen" in hidden && "a" in parsed && !("missing" in item) && !("whole" in removed) && !("b" in parsed)) t++;',
    ],
    ["a read and a test by a key", "t += item[key]; if (key in item) t++;"],
    ["reads in a for-in loop", "for (const name in item) if (item[name]) t++;"],
    gap(storeEntersTheRunTime, [
      "stores of values of the field's type",
      'item.whole = i; item.fraction = i + 0.5; item.flag = !(i & 1); item.text = "stored"; item.either = i; item.anything = i & 1 ? literal : "s"; item.maybe = i; literal.a = i;',
    ]),
    gap(storeEntersTheRunTime, [
      "stores of null and undefined",
      "item.link = null; item.maybe = undefined; item.anything = null;",
    ]),
    ["a call of one function", "t += add(i, 1);"],
    ["calls of two functions at one site", "t += (i & 1 ? add : subtract)(i, 1);"],
    ["calls of forty functions at one site", "t += many[i % 40](i, 1);"],
    ["a method call", "t += item.method();"],
    ["a call of a method that a literal defines", "t += tools.measure();"],
    ["a call of a method that is inherited from a literal", "t += heir.measure();"],
    ["a construction", "if (new Item()) t++;"],
    [
      "branches on numbers, strings, objects, booleans, undefined and null",
      'if (i & 3) t++; if (!i) t++; if (i + 0.5) t++; if (i / 0 - i / 0) t--; if (key) t++; if (!"") t++; if (literal) t++; if (item.flag) t++; if (item.maybe) t++; if (other.link) t++; if (many.length && t) t++;',
    ],
    [
      "strict equality of fractions",
      "if (i + 0.5 === i + 0.5) t++; if (i + 0.5 !== 0.25) t++; if (i + 0.5 === i) t--; if (i / 0 - i / 0 === i / 0 - i / 0) t--; const equal = i + 0.5 === 1.5, unequal = i + 0.5 !== 1.5; if (equal || unequal) t++;",
    ],
    [
      "strict equality of short strings",
      'if (key === "whole") t++; if (key !== "fraction") t++; if (item.text === "text") t++; const equal = key === item.text, unequal = key !== item.text; if (equal || unequal) t++;',
    ],
    [
      "strict equality of objects, and of values of different kinds",
      "if (item !== other) t++; if (item === item) t++; if (item !== key) t++; if (key !== i) t++; if (other.link === null) t++; if (item.maybe === undefined) t++; const equal = item === literal; if (!equal) t++;",
    ],
    [
      "two strings joined, then tested and measured",
      "const joined = key + item.text; if (joined) t++; t += joined.length;",
    ],
    ["lengths of strings", "t += key.length + item.text.length;"],
    [
      "typeof compared with object and function",
      'if (typeof item === "object") t++; if (typeof literal === "object") t++; if (typeof other.link === "object") t++; if (typeof key === "object") t--; if (typeof add === "function") t++; if (typeof many[0] === "function") t++; if (typeof Item === "function") t++; if (typeof item === "function") t--;',
    ],
    ["object literals", "const o = { value: i, issues: {} }; t += o.value;"],
    [
      "an object literal that gets more properties than it names",
      "const o = { a: i, b: 1, c: 2, d: 3, e: 4, f: 5 }; o.g = i; o.h = 1; o.j = 2; t += o.g;",
    ],
    ["an environment in each turn", "let v = i; const w = 1; t += (() => v + w)();"],
    [
      "empty array literals",
      "const a = [], b = [], c = []; b.push(i); c.push(literal); t += a.length + b.length + c.length;",
    ],
    [
      "short array literals of integers and of anything",
      "t += [i].length + [i, i, i, i, i, i, i, i, i].length + [i, literal].length;",
    ],
  ])(
    "%s",
    async (_name, body) => {
      expect(await slowPathsPerTurn(body)).toEqual(none);
    },
    60_000,
  );
});

describe.concurrent("a slow path in every turn", () => {
  test.each<[string, string, Partial<Record<Counter, number>>]>([
    ["a read that runs a getter", "t += item.computed;", { Read: 1 }],
    ["a store that runs a setter", "item.computed = i;", { Store: 1 }],
    ["a store to a frozen object", "frozen.whole = i;", { Store: 1 }],
    [
      "stores of values of other types",
      'new Item().maybe = "text"; new Item().link = 5; new Item().either = true;',
      { Store: 3 },
    ],
    ["in with a proxy", 'if ("whole" in proxy) t++;', { Presence: 1 }],
    ["a store that creates a field, after its deletion", "delete other.maybe; other.maybe = i;", { Store: 1 }],
    ["a branch on a BigInt", "if (BigInt(i)) t++;", { Branch: 1 }],
    ["the length of a proxy", "if (proxy.length) t++;", { Read: 1 }],
    [
      "array literals of ten elements and of fractions",
      "t += [i, i, i, i, i, i, i, i, i, i].length + [i + 0.5].length;",
      { Allocation: 2 },
    ],
    [
      "an empty array literal whose arrays become sparse",
      "const a = []; a[100000] = i; t += a.length;",
      { Allocation: 1 },
    ],
  ])(
    "%s",
    async (_name, body, expected) => {
      expect(await slowPathsPerTurn(body)).toEqual({ ...none, ...expected });
    },
    60_000,
  );
});
