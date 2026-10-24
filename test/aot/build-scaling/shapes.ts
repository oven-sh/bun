// Programs that are written by a rule and have a size: so many modules, wrappers, calls, layouts, statements. ./build-scaling.test.ts builds each at
// a size and at twice that size.
//
//   bun test/aot/build-scaling/shapes.ts <name of a shape, or a part of it> <size> <folder>     writes the program there
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export type Shape = {
  name: string;
  /** What `size` counts. */
  counted: string;
  /** The smaller of the two sizes. A build of twice as much takes a few seconds on one thread. */
  size: number;
  /** The entry point. */
  entry: string;
  /** `bun build --target=bun` makes one file of the program first, and that file is what is compiled. */
  isBundledFirst?: true;
  /** The build reports errors at every size, also at 0, and makes no executable. */
  isRefused?: true;
  write(size: number): Record<string, string>;
};

const upTo = <T>(count: number, make: (index: number) => T) => Array.from({ length: count }, (_, index) => make(index));
const lines = (count: number, make: (index: number) => string) => upTo(count, make).join("\n") + "\n";
const withoutLibraryTypes = JSON.stringify({ compilerOptions: { target: "esnext", module: "preserve", moduleResolution: "bundler", strict: true, noEmit: true, allowImportingTsExtensions: true, types: [] } }) + "\n";
const declaredConsole = "declare const console: { log(...values: unknown[]): void };\n";

function modulesInARow(size: number, first: string, next: (index: number) => string, main: (last: number) => string, extension: string, mainName: string) {
  const files: Record<string, string> = { [`m0.${extension}`]: first };
  for (let index = 1; index <= size; index++) files[`m${index}.${extension}`] = next(index);
  files[mainName] = main(size);
  return files;
}

const commonJSModulesInARow = (size: number) =>
  modulesInARow(
    size,
    `"use strict";\nexports.c = 1;\nexports.f = function (x) { return x + exports.c; };\n`,
    index => `"use strict";\nconst a = require("./m${index - 1}");\nexports.c = a.c + 1;\nexports.f = function (x) { return (x & 1) ? a.f(x) + exports.c : exports.c; };\n`,
    last => `"use strict";\nconst a = require("./m${last}");\nconsole.log(a.f(2), a.f(1));\n`,
    "js",
    "main.js",
  );

// Members of the host that are functions, by the expression that names them, in an order that does not depend on the Bun that runs this.
function functionsOfTheHost(count: number) {
  const holders: [string, object][] = [
    ["Bun", Bun],
    ["console", console],
    ["process", process],
    ["Math", Math],
    ["Object", Object],
    ["Reflect", Reflect],
    ["Array", Array],
    ["Number", Number],
    ["String", String],
    ["JSON", JSON],
    ["Atomics", Atomics],
    ["Promise", Promise],
    ["Date", Date],
    ["Symbol", Symbol],
    ["Intl", Intl],
    ["Buffer", Buffer],
    ["performance", performance],
    ["crypto", crypto],
  ];
  const named: string[] = [];
  for (const [holder, object] of holders) {
    for (const name of Object.getOwnPropertyNames(object).sort()) {
      if (!/^[A-Za-z][A-Za-z0-9]*$/.test(name) || ["caller", "callee", "arguments", "prototype", "main", "mainModule", "binding", "stdin", "stdout", "stderr"].includes(name)) continue;
      const property = Object.getOwnPropertyDescriptor(object, name)!;
      if (typeof property.value === "function") named.push(`${holder}.${name}`);
    }
  }
  return upTo(count, index => named[index % named.length]);
}

const statements: ((index: number) => string)[] = [
  i => `  r.push(a.map((x: any) => x + ${i}).length);`,
  i => `  r.push(o.m${i % 7}(${i}, ${i + 1}));`,
  i => `  { const p = { x: ${i}, y: a, z: "k${i % 13}" }; r.push(p.x + p.y.length + p.z.length); }`,
  i => `  { const g = (y: number) => y + a.length + ${i}; r.push(g(${i})); }`,
  i => `  r.push(o.f${i % 11} > ${i} ? o.f${i % 5} : o.g${i % 3});`,
  i => `  try { r.push(o.m${i % 7}(${i}, 1)); } catch (e) { r.push(e); }`,
  i => "  r.push(`a${o.f" + (i % 11) + "}b${" + i + "}c${a.length}`);",
  i => `  r.push(o?.q${i % 9}?.z ?? o.f${i % 11});`,
  i => `  for (const x of a) r.push(x + ${i});`,
  i => `  { const { f${i % 5}: u, f${5 + (i % 5)}: v, ...rest } = o; r.push(u + v + rest.g0); }`,
  i => `  let v${i} = a.length + ${i}; r.push(() => v${i}++);`,
];
const operand =
  "const o: any = { " +
  [...upTo(11, i => `f${i}: ${i + 1}`), ...upTo(3, i => `g${i}: ${i + 1}`), ...upTo(7, i => `m${i}(a: number, b: number) { return a + b + ${i}; }`), "p(x: number) { return Promise.resolve(x); }"].join(", ") +
  " };\n";

export const shapes: Shape[] = [
  {
    name: "ES modules that import one another in a row",
    counted: "modules",
    size: 400,
    entry: "main.mjs",
    write: size =>
      modulesInARow(
        size,
        `export const c = 1;\nexport function f(x) { return x + c; }\n`,
        index => `import * as a from "./m${index - 1}.mjs";\nexport const c = a.c + 1;\nexport function f(x) { return (x & 1) ? a.f(x) + c : c; }\n`,
        last => `import * as a from "./m${last}.mjs";\nconsole.log(a.f(2), a.f(1));\n`,
        "mjs",
        "main.mjs",
      ),
  },
  { name: "CommonJS modules that require one another in a row", counted: "modules", size: 400, entry: "main.js", write: commonJSModulesInARow },
  // A step that walked all wrappers for each wrapper, for each round: 2,000 of them took two minutes.
  { name: "CommonJS modules that a bundler has wrapped into one file", counted: "wrappers", size: 400, entry: "main.js", isBundledFirst: true, write: commonJSModulesInARow },
  {
    name: "typed modules that share the types of one module",
    counted: "modules",
    size: 300,
    entry: "main.ts",
    write: size => ({
      "tsconfig.json": withoutLibraryTypes,
      "types.ts": `export interface Item { id: number; name: string; next?: Item; tags: string[] }\nexport type Kind = { kind: "a"; value: number } | { kind: "b"; text: string };\n`,
      ...Object.fromEntries(
        upTo(size, index => [
          `m${index}.ts`,
          `import type { Item, Kind } from "./types.ts";\n${index ? `import { run${index - 1} } from "./m${index - 1}.ts";\n` : ""}` +
            `export function run${index}(item: Item, kind: Kind): number {\n  const local: Item = { id: item.id + ${index}, name: item.name, tags: item.tags };\n` +
            `  return (kind.kind === "a" ? kind.value : kind.text.length) + local.id + local.tags.length${index ? ` + run${index - 1}(local, kind)` : ""};\n}\n`,
        ]),
      ),
      "main.ts": `${declaredConsole}${size ? `import { run${size - 1} } from "./m${size - 1}.ts";\nconsole.log(run${size - 1}({ id: 1, name: "n", tags: [] }, { kind: "a", value: 2 }));\n` : "console.log(0);\n"}`,
    }),
  },
  {
    name: "functions that call what nobody knows",
    counted: "calls",
    size: 1500,
    entry: "main.js",
    write: size => ({
      "main.js":
        `const unknown = JSON.parse(process.argv[2] ?? "{}");\n` +
        lines(size, index => `function f${index}(x) { return typeof unknown.m${index % 50} === "function" ? unknown.m${index % 50}(x, f${index + 1}) : f${index + 1}(x + 1); }`) +
        `function f${size}(x) { return x; }\nconsole.log(f0(0));\n`,
    }),
  },
  // A watch at every call of an unknown callee on a set that grows from round to round: calls x members x versions of the set. The tables passed 4 GB on a large program.
  {
    name: "functions of the host that are held in variables, beside calls of what nobody knows",
    counted: "variables and calls",
    size: 75,
    entry: "main.js",
    write: size => {
      const named = functionsOfTheHost(size);
      // Each function is found only when the one in front of it has been: it is stored into a field there, and one place calls what the field holds.
      return {
        "main.js":
          `const unknown = JSON.parse(process.argv[2] ?? "{}");\nconst state = { next: f0, held: 0 };\n` +
          lines(size, index => `function f${index}() { const h = ${named[index]}; if (typeof h === "function") state.held++; state.next = f${index + 1}; if (typeof unknown.m${index % 50} === "function") unknown.m${index % 50}(h); }`) +
          `function f${size}() { state.next = null; }\nwhile (state.next) state.next();\nconsole.log(state.held);\n`,
      };
    },
  },
  {
    name: "classes whose methods of one name are called at one place",
    counted: "classes",
    size: 400,
    entry: "main.ts",
    write: size => ({
      "tsconfig.json": withoutLibraryTypes,
      "main.ts":
        declaredConsole +
        `interface Shape { area(): number }\n` +
        lines(size, index => `class C${index} implements Shape { constructor(readonly side${index % 7}: number) {} area() { return this.side${index % 7} * ${index}; } }`) +
        `const all: Shape[] = [${upTo(size, index => `new C${index}(${index})`).join(", ")}];\nlet sum = 0;\nfor (const each of all) sum += each.area();\nconsole.log(sum);\n`,
    }),
  },
  {
    name: "literals of different layouts that are read at one place",
    counted: "layouts",
    size: 500,
    entry: "main.js",
    write: size => ({
      "main.js":
        `const all = [\n${lines(size, index => `  { n${index}: ${index}, shared: ${index}, m${index % 17}: "t" },`)}];\nlet sum = 0;\nfor (const each of all) sum += each.shared;\nfunction keys(o) { return Object.keys(o).length; }\nfor (const each of all) sum += keys(each);\nconsole.log(sum);\n`,
    }),
  },
  {
    name: "one function of many statements",
    counted: "statements",
    size: 1200,
    entry: "main.ts",
    write: size => ({
      "tsconfig.json": withoutLibraryTypes,
      "main.ts": `${declaredConsole}function large(a: any, o: any, r: any[]) {\n${lines(size, index => statements[index % statements.length](index))}}\n${operand}const out: any[] = [];\nlarge([1, 2, 3], o, out);\nconsole.log(out.length);\n`,
    }),
  },
  // Every statement tests the same two parameters again: whoever asks each test about every other test of the same value asks a million times.
  {
    name: "arrays and objects that one function makes, between calls of what nobody knows",
    counted: "statements",
    size: 500,
    entry: "main.js",
    write: size => ({
      "main.js":
        "function large(f, o, p) {\n  let sum = 0;\n" +
        lines(
          size,
          i =>
            `  const a${i} = [${i}, ${i + 1}]; const b${i} = { x: ${i}, y: o.k${i % 7} };\n` +
            `  f(o, ${i}); a${i}.push(p.v${i % 5}); sum += a${i}.length + b${i}.x + o.k${i % 7} + p.v${i % 5};` +
            (i >= 3 ? `\n  if (a${i - 3}.includes(sum)) sum += a${i - 3}.indexOf(${i}) + b${i - 3}.y; f(b${i - 2});` : ""),
        ) +
        "  return sum;\n}\n" +
        "const o = { k0: 1, k1: 2, k2: 3, k3: 4, k4: 5, k5: 6, k6: 7 }, p = { v0: 1, v1: 2, v2: 3, v3: 4, v4: 5 };\n" +
        "for (let i = 0; i < 3; i++) console.log(large(globalThis.process.argv.length > 5 ? eval : function (x) { return x; }, o, p));\n",
    }),
  },
  // Each object has a set of its own in the escape analysis, and a set had a bit for each object: objects x objects, with no limit.
  {
    name: "objects that one function makes and hands to one array",
    counted: "objects",
    size: 10000,
    entry: "main.ts",
    write: size => ({
      "tsconfig.json": withoutLibraryTypes,
      "main.ts": `${declaredConsole}function fill(x: number, all: { a: number }[]) {\n${lines(size, () => "  all.push({ a: x });")}}\nconst all: { a: number }[] = [];\nfill(all.length + 3, all);\nconsole.log(all.length);\n`,
    }),
  },
  {
    name: "one async function of many awaits",
    counted: "awaits",
    size: 800,
    entry: "main.ts",
    write: size => ({
      "tsconfig.json": withoutLibraryTypes,
      "main.ts": `${declaredConsole}async function large(o: any, r: any[]) {\n${lines(size, index => `  r.push(await o.p(${index}));`)}}\n${operand}const out: any[] = [];\nlarge(o, out).then(() => console.log(out.length));\n`,
    }),
  },
  // A join "paid" while any join that takes its object was still a candidate, so a row of merge blocks was given up from its far end, one parameter for each analysis of the whole function.
  {
    name: "a row of branches that hand one new object on",
    counted: "branches",
    size: 150,
    entry: "main.js",
    write: size => ({
      "main.js": `function row(n) {\n  let o = { a: n, b: 1 };\n${lines(size, index => `  if (n & ${1 << index % 20}) o = { a: o.a + ${index}, b: o.b }; else o.b += ${index};`)}  return o.a + o.b;\n}\nlet sum = 0;\nfor (let i = 0; i < 50; i++) sum += row(i);\nconsole.log(sum);\n`,
    }),
  },
  // Each function without a loop was walked whole again for each of its writers: writers x values.
  {
    name: "one function that stores numbers into many fields",
    counted: "stores",
    size: 1500,
    entry: "main.ts",
    write: size => ({
      "tsconfig.json": withoutLibraryTypes,
      "main.ts":
        declaredConsole +
        `class Counters {\n${lines(Math.max(size, 1), index => `  c${index} = 0;`)}}\nfunction fill(counters: Counters, n: number) {\n${lines(size, index => `  counters.c${index} = n + ${index};`)}}\nconst counters = new Counters();\nfill(counters, 3);\nconsole.log(counters.c0);\n`,
    }),
  },
  {
    name: "closures that are handed to one helper",
    counted: "closures",
    size: 1000,
    entry: "main.js",
    write: size => ({
      "main.js": `function each(list, callback) { let sum = 0; for (let i = 0; i < list.length; i++) sum += callback(list[i], i); return sum; }\nconst list = [1, 2, 3];\nlet sum = 0;\n${lines(size, index => `sum += each(list, (x, i) => x * ${index} + i);`)}console.log(sum);\n`,
    }),
  },
  {
    name: "functions that call one another at random",
    counted: "functions",
    size: 600,
    entry: "main.js",
    write: size => {
      let seed = 7;
      const next = () => (seed = (seed * 48_271) % 2_147_483_647) % Math.max(size, 1);
      return {
        "main.js":
          lines(size, index => `function f${index}(node, depth) {\n${[0, 1, 2].map(tag => `  if (node.tag === ${tag}) return f${next()}(node.next, depth + ${tag});`).join("\n")}\n  return node.value;\n}`) +
          `console.log(${size ? "f0({ tag: 9, value: 1, next: null }, 0)" : "1"});\n`,
      };
    },
  },
  {
    name: "a union of object types that is told apart by a tag",
    counted: "members",
    size: 300,
    entry: "main.ts",
    write: size => ({
      "tsconfig.json": withoutLibraryTypes,
      "main.ts":
        declaredConsole +
        lines(Math.max(size, 1), index => `interface T${index} { kind: "k${index}"; v${index}: number }`) +
        `type Any = ${upTo(Math.max(size, 1), index => `T${index}`).join(" | ")};\nfunction read(value: Any): number {\n  switch (value.kind) {\n${lines(Math.max(size, 1), index => `    case "k${index}": return value.v${index};`)}  }\n}\n` +
        `const all: Any[] = [${upTo(Math.max(size, 1), index => `{ kind: "k${index}", v${index}: ${index} }`).join(", ")}];\nlet sum = 0;\nfor (const each of all) sum += read(each);\nconsole.log(sum);\n`,
    }),
  },
  {
    name: "one literal of many names, each read by name",
    counted: "names",
    size: 1500,
    entry: "main.js",
    write: size => ({
      "main.js": `const table = {\n${lines(size, index => `  name${index}: ${index},`)}};\nlet sum = 0;\n${lines(size, index => `sum += table.name${index};`)}console.log(sum);\n`,
    }),
  },
  {
    name: "exports of one module that another imports by name",
    counted: "exports",
    size: 1500,
    entry: "main.mjs",
    write: size => ({
      "all.mjs": lines(size, index => `export function f${index}(x) { return x + ${index}; }`) + "export const none = 0;\n",
      "main.mjs": `import { none${upTo(size, index => `, f${index}`).join("")} } from "./all.mjs";\nlet sum = none;\n${lines(size, index => `sum = f${index}(sum);`)}console.log(sum);\n`,
    }),
  },
  {
    name: "strings and regular expressions that are written once each",
    counted: "constants",
    size: 1500,
    entry: "main.js",
    write: size => ({
      "main.js": `let sum = 0;\nfunction use(text, pattern) { sum += pattern.test(text) ? text.length : 1; }\n${lines(size, index => `use("text number ${index}", /n[u]mber ${index}$/);`)}console.log(sum);\n`,
    }),
  },
  // Behind a row of loops the exit of each stands above every later place. Each step of each proof that a position lies inside an array walked all of them and worked out anew what each says:
  // 1,200 loops took 1,760,000 M instructions.
  {
    name: "loops in a row in one function",
    counted: "loops",
    size: 200,
    entry: "main.js",
    write: size => ({
      "main.js": `function run(list) {\n  let sum = 0;\n${lines(size, index => `  for (let i = 0; i < list.length; i++) sum = (sum + list[i] * ${index}) | 0;`)}  return sum;\n}\nconsole.log(run([1, 2, 3]));\n`,
    }),
  },
  // A read of a variable passes every earlier compound assignment to it, and at each of them the checker walked to the start of the function to see whether the place can be reached.
  {
    name: "a string that grows by one statement after another",
    counted: "statements",
    size: 750,
    entry: "main.js",
    write: size => ({
      "main.js": `function run(a) {\n  let s = "";\n${lines(size, index => `  s += a + "${index},";`)}  return s.length;\n}\nconsole.log(run("x"));\n`,
    }),
  },
  // `n += ..` needs the type of n at the statement before, so the checker's walk is as deep as the block is long: past its greatest depth every statement pays a walk of that depth.
  {
    name: "one try block of many calls",
    counted: "calls",
    size: 1500,
    entry: "main.js",
    write: size => ({
      "main.js": `function run(o) {\n  let n = 0;\n  try {\n${lines(size, index => `    n += o.f(${index});`)}  } catch (e) {\n    n = -1;\n  }\n  return n;\n}\nconsole.log(run({ f(x) { return x & 3; } }));\n`,
    }),
  },
  // The table of what a module exports copies the table of the module that it exports everything of.
  {
    name: "modules that export everything of the one before",
    counted: "modules",
    size: 200,
    entry: "main.mjs",
    write: size => ({
      "m0.mjs": "export const v0 = 0;\n",
      ...Object.fromEntries(upTo(size, index => [`m${index + 1}.mjs`, `export * from "./m${index}.mjs";\nexport const v${index + 1} = ${index + 1};\n`])),
      "main.mjs": `import * as all from "./m${size}.mjs";\nconsole.log(all.v0 + all.v${size});\n`,
    }),
  },
  // A lookup that goes up a row of classes notes a condition for each class that it passes, in a sorted list, once for each access of each constructor.
  {
    name: "classes that extend one another in a row",
    counted: "classes",
    size: 100,
    entry: "main.js",
    write: size => ({
      "main.js":
        `class C0 { constructor() { this.v0 = 0; } m0() { return 0; } }\n` +
        lines(size, index => `class C${index + 1} extends C${index} { constructor() { super(); this.v${index + 1} = ${index + 1}; } m${index + 1}() { return this.m${index}() + this.v${index + 1}; } }`) +
        `console.log(new C${size}().m${size}());\n`,
    }),
  },
  {
    name: "functions on one line after non-ASCII text",
    counted: "functions",
    size: 2000,
    entry: "main.js",
    write: size => ({
      "main.js":
        `const table = []; ` +
        upTo(size, index => `table.push(function (a) { return a.first("${"\u5b57".repeat(400)}" + a.second) + a.third(${index}); });`).join(" ") +
        ` let thrown = 0; for (const f of table) { try { f(null); } catch { thrown++; } } console.log(thrown);\n`,
    }),
  },
  {
    name: "constant objects in one array literal",
    counted: "objects",
    size: 10000,
    entry: "main.ts",
    write: size => ({
      "tsconfig.json": withoutLibraryTypes,
      "main.ts": `${declaredConsole}const table = [\n${lines(size, index => `  { id: ${index}, name: "n${index}", tags: ["a", "b${index % 5}"] },`)}];\nconsole.log(table.length);\n`,
    }),
  },
  {
    name: "pairs in the array literal that a Map is made of",
    counted: "pairs",
    size: 20000,
    entry: "main.js",
    write: size => ({
      "main.js": `const table = new Map([\n${lines(size, index => `  ["key${index}", ${index}],`)}]);\nconsole.log(table.size);\n`,
    }),
  },
  {
    name: "objects in the array of a JSON module",
    counted: "objects",
    size: 10000,
    entry: "main.ts",
    write: size => ({
      "tsconfig.json": JSON.stringify({ compilerOptions: { ...JSON.parse(withoutLibraryTypes).compilerOptions, resolveJsonModule: true } }) + "\n",
      "data.json": `[${upTo(size, index => `{ "id": ${index}, "name": "n${index}", "tags": ["a", "b${index % 5}"] }`).join(",\n")}]\n`,
      "main.ts": `${declaredConsole}import data from "./data.json";\nconsole.log(data.length);\n`,
    }),
  },
  {
    name: "objects with a computed member in one array literal",
    counted: "objects",
    size: 2000,
    entry: "main.js",
    write: size => ({
      "main.js": `function make(k) {\n  return [\n${lines(size, index => `    { id: ${index} + k, name: "n${index}" },`)}  ];\n}\nconsole.log(make(1).length);\n`,
    }),
  },
  {
    name: "states of one switch in a loop",
    counted: "states",
    size: 1000,
    entry: "main.js",
    write: size => ({
      "main.js":
        `function run(k) {\n  let state = 0, sum = 0;\n  for (;;) {\n    switch (state) {\n` +
        lines(size, index =>
          index % 3
            ? `      case ${index}: sum += k + ${index}; state = ${index + 1}; continue;`
            : `      case ${index}: sum ^= ${index}; state = k > 0 ? ${index + 1} : ${Math.min(index + 2, size)}; break;`,
        ) +
        `      default: return sum;\n    }\n  }\n}\nconsole.log(run(1), run(-1));\n`,
    }),
  },
  {
    name: "names that one function reads from an object nobody knows",
    counted: "names",
    size: 2500,
    entry: "main.js",
    write: size => ({
      "main.js": `function f(o) {\n  let sum = 0;\n${lines(size, index => `  sum += o.name${index} | 0;`)}  return sum;\n}\nconsole.log(f({ name1: 4 }));\n`,
    }),
  },
  {
    name: "floored divisions that each take the result of the one before",
    counted: "divisions",
    size: 1000,
    entry: "main.js",
    write: size => ({
      "main.js": `function f(a) {\n  let x = a | 0;\n${lines(size, () => `  x = Math.floor(x / 3) + 7;`)}  return x;\n}\nconsole.log(f(1000000));\n`,
    }),
  },
  {
    name: "functions in a ring that hand a new object on",
    counted: "functions",
    size: 500,
    entry: "main.js",
    write: size => ({
      "main.js": size
        ? `${lines(size, index => `function f${index}(x, d) { return d <= 0 ? x : f${(index + 1) % size}({ v: x.v + ${index} }, d - 1); }`)}console.log(f0({ v: 1 }, 50).v);\n`
        : "console.log(0);\n",
    }),
  },
  {
    name: "a declaration where an expression belongs, nested in itself",
    counted: "levels",
    size: 4000,
    entry: "main.ts",
    isRefused: true,
    write: size => ({
      "main.ts": `const list = [1, 2, 3];\nlist.forEach(x => ${"type T = A extends B ? ".repeat(size)}1${" : C".repeat(size + 1)});\nconsole.log(list.length);\n`,
    }),
  },
];

if (import.meta.main) {
  const [wanted, size, folder] = process.argv.slice(2);
  const shape = shapes.find(shape => shape.name.includes(wanted));
  if (!shape || !folder) throw new Error("usage: bun test/aot/build-scaling/shapes.ts <name of a shape, or a part of it> <size> <folder>");
  for (const [name, text] of Object.entries(shape.write(Number(size)))) {
    mkdirSync(dirname(join(folder, name)), { recursive: true });
    writeFileSync(join(folder, name), text);
  }
}
