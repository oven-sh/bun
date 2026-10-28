// Programs that are written by a rule and have a size: so many modules, wrappers, calls, layouts, statements. ./build-scaling-cases.ts builds each at
// a size and at twice that size.
//
//   bun test/aot/build-scaling/shapes.ts <name of a shape, or a part of it> <size> <folder>     writes the program there
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { buildFlags } from "../harness/flags";

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
  /** What the build is given besides. Such a shape is no entry point of the build of all shapes. */
  flags?: string[];
  /** Not an entry point of the build of all shapes. */
  isExcludedFromCombinedBuild?: true;
  /** Statistics of the build's report that count steps of work. Their growth is held as that of the instructions is, also where instructions cannot be counted. */
  counts?: string[];
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

// A file whose tsconfig.json sets one of these differently from the entry point's gets a separate checker program.
const programWideOptions: [name: string, nonDefault: boolean][] = [
  ["strictNullChecks", false],
  ["strictFunctionTypes", false],
  ["strictBindCallApply", false],
  ["strictBuiltinIteratorReturn", false],
  ["exactOptionalPropertyTypes", true],
  ["allowJs", true],
];

/** Up to 63 packages, no two with the same options. */
export const packagesWithOwnCompilerOptions: Shape = {
  name: "TypeScript packages that each have a tsconfig.json with different compiler options",
  counted: "packages",
  size: 12,
  entry: "main.ts",
  isExcludedFromCombinedBuild: true,
  write: size => ({
    "tsconfig.json": withoutLibraryTypes,
    "main.ts":
      declaredConsole +
      lines(size, index => `import { run19 as run${index} } from "package-${index}";`) +
      `let sum = 0;\n` +
      lines(size, index => `sum += run${index}({ id: ${index}, name: "n", tags: [] }, 1);`) +
      `console.log(sum);\n`,
    ...Object.fromEntries(
      upTo(size, index => {
        const changed = programWideOptions.filter((_, bit) => ((index + 1) >> bit) & 1);
        const compilerOptions = { ...JSON.parse(withoutLibraryTypes).compilerOptions, ...Object.fromEntries(changed) };
        return [
          [`node_modules/package-${index}/package.json`, JSON.stringify({ name: `package-${index}`, type: "module", exports: "./index.ts" }) + "\n"],
          [`node_modules/package-${index}/tsconfig.json`, JSON.stringify({ compilerOptions }) + "\n"],
          [
            `node_modules/package-${index}/index.ts`,
            `export interface Item { id: number; name: string; next?: Item; tags: string[] }\n` +
              lines(
                20,
                at =>
                  `export function run${at}(item: Item, by: number): number {\n  const local: Item = { id: item.id + ${at} + by, name: item.name, tags: item.tags };\n` +
                  `  return local.id + local.name.length + local.tags.length${at ? ` + run${at - 1}(local, by + 1)` : ""};\n}`,
              ),
          ],
        ];
      }).flat(),
    ),
  }),
};

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
  // The type of the list at a push follows from the pushes before it: pushes x pushes, and each step made a union of the objects so far.
  // A branch after every tenth push, so that the way back from a push to the declaration is no straight line.
  // TypeScript checks no body in which that way nests 2,000 deep, so a list takes 1,500.
  {
    name: "objects that statements push onto a list without a type",
    counted: "objects",
    size: 750,
    entry: "main.ts",
    isExcludedFromCombinedBuild: true,
    write: size => ({
      "tsconfig.json": withoutLibraryTypes,
      "main.ts":
        declaredConsole +
        lines(size, index => {
          const list = `all${Math.floor(index / 1500)}`;
          return (
            (index % 1500 ? "" : `const ${list} = [];\n`) +
            (index % 10 ? "" : `if (${list}.length > ${index}) console.log(${index});\n`) +
            `${list}.push({ a: ${index}, b: "x" });`
          );
        }) +
        `console.log(${size ? "all0.length" : 0});\n`,
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
  // `n += ..` needs the type of n at the statement before, and so on up to the start of the block. In a `try` block each assignment also leads to the handler.
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
  // Each constructor is small enough to go into the one below it, which goes into the one below that: every level is one more round over all that a constructor has taken in.
  {
    name: "classes that extend one another in a row, each constructed",
    counted: "classes",
    size: 125,
    entry: "main.js",
    write: size => ({
      "main.js":
        `class C0 {\n  constructor() {\n    this.f0 = 0;\n  }\n}\n` +
        lines(size, index => `class C${index + 1} extends C${index} {\n  constructor() {\n    super();\n    this.f${index + 1} = ${index + 1};\n  }\n}`) +
        `let sum = 0;\n` +
        lines(size + 1, index => `sum += new C${index}().f${index};`) +
        `console.log(sum);\n`,
    }),
  },
  // Whether the fields of two classes tell their objects apart is asked for each pair of classes, and the fields of a class are also those of all the classes above it.
  {
    name: "classes without fields that extend one another in a row",
    counted: "classes",
    size: 400,
    entry: "main.js",
    // Nothing besides: it takes 50 MB, and so stays out of the build of all shapes, whose budget was counted without it.
    flags: [],
    write: size => ({
      "main.js":
        `class C0 {\n  m0() {\n    return 0;\n  }\n}\n` +
        lines(size, index => `class C${index + 1} extends C${index} {\n  m${index + 1}() {\n    return ${index + 1};\n  }\n}`) +
        `console.log(new C${size}().m0());\n`,
    }),
  },
  // What the objects of a class hold is listed class by class up the row: a field counts where no class further down has one of its name.
  {
    name: "functions that each make a class below the one that the function before has made",
    counted: "functions",
    size: 400,
    entry: "main.js",
    // Nothing besides: it stays out of the build of all shapes, whose budget was counted without it.
    flags: [],
    write: size => ({
      "main.js":
        `class Base {\n  constructor() {\n    this.base = 1;\n  }\n}\n` +
        lines(size, index => `function mix${index}(Above) {\n  return class extends Above {\n    constructor() {\n      super();\n      this.mixed${index} = ${index};\n    }\n  };\n}`) +
        `let Top = Base;\n` +
        lines(size, index => `Top = mix${index}(Top);`) +
        `const top = new Top();\nlet sum = 0;\n` +
        lines(size, index => `sum += top.mixed${index};`) +
        `console.log(sum);\n`,
    }),
  },
  // Which class of a row holds a field is asked for each class that an access may meet, and the answer lies as many classes up as the row is long.
  {
    name: "classes with a field each that extend one another in a row, all constructed at one place",
    counted: "classes",
    size: 250,
    entry: "main.js",
    // Nothing besides: it stays out of the build of all shapes, whose budget was counted without it.
    flags: [],
    write: size => ({
      "main.js":
        `class C0 {\n  f0 = 0;\n}\n` +
        lines(size, index => `class C${index + 1} extends C${index} {\n  f${index + 1} = ${index + 1};\n}`) +
        `const classes = [\n` +
        lines(size + 1, index => `  C${index},`) +
        `];\nlet sum = 0;\nfor (const made of classes) sum += new made().f0;\nconsole.log(sum);\n`,
    }),
  },
  // Who reads a chain of prototypes that is still being found waits for the whole of it once the chain has grown some links: a row costs the same a class on both sides of that length.
  {
    name: "rows of classes that functions make one below the other, by the length of a row",
    counted: "classes in each of 40 rows",
    size: 10,
    entry: "main.js",
    // Nothing besides: it stays out of the build of all shapes, whose budget was counted without it.
    flags: [],
    write: size => ({
      "main.js":
        `let sum = 0;\n` +
        lines(
          40,
          row =>
            `class Base${row} {\n  constructor() {\n    this.base = ${row};\n  }\n}\n` +
            lines(size, index => `function mix${row}x${index}(Above) {\n  return class extends Above {\n    constructor() {\n      super();\n      this.mixed${index} = ${index};\n    }\n  };\n}`) +
            `let Top${row} = Base${row};\n` +
            lines(size, index => `Top${row} = mix${row}x${index}(Top${row});`) +
            `const top${row} = new Top${row}();\n` +
            lines(size, index => `sum += top${row}.mixed${index};`),
        ) +
        `console.log(sum);\n`,
    }),
  },
  // What the base class allocates for a class below what a function makes is an object of that class: a constructor meets the objects of the classes below it and of no other.
  {
    name: "classes that each extend what a function of their own makes of one base class",
    counted: "classes",
    size: 200,
    entry: "main.js",
    // Nothing besides: it stays out of the build of all shapes, whose budget was counted without it.
    flags: [],
    write: size => ({
      "main.js":
        `class Base {\n  constructor() {\n    this.base = 1;\n  }\n}\n` +
        lines(
          size,
          index =>
            `function mix${index}(Above) {\n  return class extends Above {\n    constructor() {\n      super();\n      this.mixed${index} = ${index};\n    }\n  };\n}\n` +
            `class Below${index} extends mix${index}(Base) {\n  constructor() {\n    super();\n    this.below${index} = ${index};\n  }\n}`,
        ) +
        `let sum = 0;\n` +
        lines(size, index => `sum += new Below${index}().below${index};`) +
        `console.log(sum);\n`,
    }),
  },
  // Each place may call every function. They are too many to be told apart there, which is seen before they are put in order.
  {
    name: "functions that are stored one after another under one name of one object and called there",
    counted: "functions",
    size: 250,
    entry: "main.js",
    // Nothing besides: it stays out of the build of all shapes, whose budget was counted without it.
    flags: [],
    write: size => ({
      "main.js":
        `const holder = { run: null };\nlet sum = 0;\n` +
        lines(size, index => `holder.run = function () {\n  return ${index};\n};\nsum += holder.run();`) +
        `console.log(sum);\n`,
    }),
  },
  // A type lists no more than 16 functions here, so each place only expects its callees. Whether a test of the called value has failed earlier is asked once a place.
  {
    name: "functions that are stored one after another under one name and called there, more than a type lists",
    counted: "functions",
    size: 250,
    entry: "main.js",
    flags: ["--aot-limit=MaxFunctionsInType:16"],
    write: size => ({
      "main.js":
        `const holder = { run: null };\nlet sum = 0;\n` +
        lines(size, index => `holder.run = function () {\n  return ${index};\n};\nsum += holder.run();`) +
        `console.log(sum);\n`,
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
    name: "steps of a chain of calls that each add a class to one array, whose elements are read under many names",
    counted: "steps, and a tenth of the names",
    size: 40,
    entry: "main.js",
    write: size => ({
      "main.js": size
        ? `const all = [];\n${lines(size, index => `class C${index} { constructor() { this.own${index} = ${index}; } }`)}${lines(size, index => `const step${size - 1 - index} = { run() { all.push(new C${size - 1 - index}()); return ${index ? `step${size - index}` : "null"}; } };`)}let step = step0;\nwhile (step) step = step.run();\nconst pick = all[process.argv.length % all.length];\nlet sum = 0;\n${lines(10 * size, index => `if (pick.name${index} !== undefined) sum += ${index};`)}console.log(all.length, sum);\n`
        : "console.log(0);\n",
    }),
  },
  {
    name: "terms of one sum that name a constant",
    counted: "terms",
    size: 8000,
    entry: "main.ts",
    write: size => ({
      "tsconfig.json": withoutLibraryTypes,
      "main.ts": `${declaredConsole}const one = 1 as number;\nconsole.log(one${" + one".repeat(size)});\n`,
    }),
  },
  {
    name: "functions with a row of constants that are each computed from the one before",
    counted: "functions",
    size: 400,
    entry: "main.js",
    write: size => ({
      "main.js": `let sum = 0;\n${lines(size, index => `function f${index}() {\n  const c0 = ${index};\n${lines(24, step => `  const c${step + 1} = c${step} + c${step};`)}  return c24;\n}\nsum += f${index}();`)}console.log(sum);\n`,
    }),
  },
  {
    name: "rows of constants that are each named after the one before, at the top of a file and in a function",
    counted: "constants in each row",
    size: 3000,
    entry: "main.js",
    write: size => {
      const rows: [string, string, (earlier: string) => string][] = [
        ["name", `"node:path"`, earlier => earlier],
        ["negated", "1", earlier => `-${earlier}`],
        ["inverted", "true", earlier => `!${earlier}`],
        ["nothing", "undefined", earlier => `void ${earlier}`],
        ["kind", "1", earlier => `typeof ${earlier}`],
        ["chosen", "true", earlier => `${earlier} ? true : false`],
      ];
      const declared =
        rows.map(([name, first]) => `const ${name}0 = ${first};`).join(" ") +
        "\n" +
        lines(size, index => rows.map(([name, , next]) => `const ${name}${index + 1} = ${next(`${name}${index}`)};`).join(" "));
      const last = rows.map(([name]) => `${name}${size}`).join(", ");
      return {
        "main.js":
          `${declared}console.log(require(name${size}).sep, process.getBuiltinModule(name${size}).sep, ${last});\n` +
          `function inFunction() {\n${declared}  return [require(name${size}).sep, process.getBuiltinModule(name${size}).sep, ${last}];\n}\nconsole.log(...inFunction());\n` +
          `import(name${size}).then(loaded => console.log(loaded.sep));\n`,
      };
    },
  },
  {
    name: "long rows of constants that are each computed from the one before, each row in a function or a block of its own",
    counted: "constants in each row",
    size: 4000,
    entry: "main.js",
    write: size => {
      const row = (first: string, step: string) => `  const c0 = ${first};\n${lines(size, index => `  const c${index + 1} = c${index}${step};`)}`;
      const rows = [row("1", " + 1"), row(`"a"`, ` + ""`)];
      return {
        "main.js":
          rows.map((row, index) => `function row${index}() {\n${row}  return c${size};\n}\nconsole.log(row${index}());\n`).join("") +
          rows.map(row => `{\n${row}  console.log(c${size});\n}\n`).join(""),
      };
    },
  },
  // Each place constructs any class of one list for any class of the other, and who allocates for a class below a call is found among the class objects above it.
  {
    name: "classes below a function that makes their base, kept in a list and constructed for the classes of another list",
    counted: "classes",
    size: 200,
    entry: "main.js",
    write: size => ({
      "main.js":
        `function withCount(Base) {\n  return class extends Base {\n    count() {\n      return 1;\n    }\n  };\n}\nconst below = [];\nconst beside = [];\nlet sum = 0;\n` +
        lines(
          size,
          index =>
            `function step${index}() {\n  class Base {}\n  below.push(class extends withCount(Base) {});\n  beside.push(class extends Base {});\n` +
            `  return Reflect.construct(below[${index}], [], beside[${index}]) instanceof Base ? 1 : 0;\n}\nsum += step${index}();`,
        ) +
        `console.log(sum);\n`,
    }),
  },
  // Every base constructor may allocate for any of the classes, and every constructor below stores into what any of them allocated.
  {
    name: "classes below one function that makes their base, each constructed for a class beside it, that store through this",
    counted: "classes",
    size: 125,
    entry: "main.js",
    write: size => ({
      "main.js":
        `function withCount(Base) {\n  return class extends Base {\n    count() {\n      return 1;\n    }\n  };\n}\n` +
        lines(
          size,
          index =>
            `class Base${index} {\n  constructor() {\n    this.base${index} = ${index};\n  }\n}\n` +
            `class Below${index} extends withCount(Base${index}) {\n  constructor() {\n    super();\n    this.below${index} = ${index};\n  }\n}\n` +
            `class Beside${index} extends Base${index} {\n  beside${index} = ${index};\n}`,
        ) +
        `let sum = 0;\n` +
        lines(size, index => `sum += new Below${index}().below${index} + Reflect.construct(Below${index}, [], Beside${index}).base${index};`) +
        `console.log(sum);\n`,
    }),
  },
  // What a base class allocates for a class nobody knows may be an object of any class that is out of sight: each such class has all those allocations among its objects.
  {
    name: "classes that each extend a class of their own, all stored on the global object under computed names",
    counted: "pairs of classes",
    size: 1600,
    entry: "main.js",
    isExcludedFromCombinedBuild: true,
    write: size => ({
      "main.js":
        `let sum = 0;\nclass First {}\nglobalThis["k" + sum] = First;\n` +
        lines(size, index => `class Base${index} {}\nclass Below${index} extends Base${index} {}\nif (new Below${index}() instanceof Base${index}) sum++;\nglobalThis["k" + sum] = Below${index};`) +
        `console.log(sum);\n`,
    }),
  },
  {
    name: "classes that are all declared before the first is constructed, in a build that validates",
    counted: "classes",
    size: 1500,
    entry: "main.ts",
    flags: [buildFlags.validate],
    write: size => ({
      "tsconfig.json": withoutLibraryTypes,
      "main.ts":
        declaredConsole +
        `interface Member { v: number }\n` +
        lines(size, index => `class C${index} { v = 0; x${index} = 1; }`) +
        `const members: Member[] = [];\n` +
        lines(size, index => `members.push(new C${index}());`) +
        `function readMember(m: Member): number { return m.v; }\nlet sum = 0;\nfor (const m of members) sum += readMember(m);\nconsole.log(sum, members.length);\nexport {};\n`,
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
  // Each name asks whether the iterator has ended, and every way to that question knows the answer. The names taken so far are all read at the end.
  ...(
    [
      ["names that a list pattern takes from a typed array or a list", 1000, (index: number) => `e${index}`, "", ""],
      ["names with defaults that a list pattern takes from a typed array or a list", 1000, (index: number) => `e${index} = ${index}`, "", ""],
      ["names that a list pattern takes from a typed array or a list, in front of a rest element", 1000, (index: number) => `e${index}`, ", ...more", " + more.length"],
      // What takes a step for each name at each name shows from here on.
      ["very many names that a list pattern takes from a typed array or a list", 8000, (index: number) => `e${index}`, "", ""],
    ] as const
  ).map(
    ([name, smallerSize, element, rest, readsRest]): Shape => ({
      name,
      counted: "names",
      size: smallerSize,
      entry: "main.js",
      isExcludedFromCombinedBuild: true,
      write: size => ({
        "main.js":
          `function apart(list) {\n  const [first, ${upTo(size, element).join(", ")}${rest}] = list;\n  return [first, ${upTo(size, index => `e${index}`).join(", ")}].join()${readsRest};\n}\n` +
          `console.log(apart(new Uint8Array(${size})).length, apart([${upTo(size, index => index).join(", ")}]).length, apart([]).length);\n`,
      }),
    }),
  ),
  // Each pattern takes one element of what the pattern around it has taken, and the iterator of the outer one is open for as long as the inner ones run.
  {
    name: "list patterns nested in one another",
    counted: "levels",
    size: 200,
    entry: "main.js",
    isExcludedFromCombinedBuild: true,
    write: size => ({
      "main.js": `function apart(list) {\n  const [${"[".repeat(size)}inmost${"]".repeat(size)}] = list;\n  return inmost;\n}\nconsole.log(apart([${"[".repeat(size)}7${"]".repeat(size)}]));\n`,
    }),
  },
  {
    name: "names that an object pattern takes, all read at the end",
    counted: "names",
    size: 16000,
    entry: "main.js",
    isExcludedFromCombinedBuild: true,
    write: size => ({
      "main.js":
        `function apart(object) {\n  const { first, ${upTo(size, index => `e${index}`).join(", ")} } = object;\n  return [first, ${upTo(size, index => `e${index}`).join(", ")}].join();\n}\n` +
        `console.log(apart({ first: 1, ${upTo(size, index => `e${index}: ${index}`).join(", ")} }).length, apart({}).length);\n`,
    }),
  },
  {
    name: "parameters of one function, all read at the end",
    counted: "parameters",
    size: 16000,
    entry: "main.js",
    isExcludedFromCombinedBuild: true,
    write: size => ({
      "main.js":
        `function apart(first, ${upTo(size, index => `e${index}`).join(", ")}) {\n  return [first, ${upTo(size, index => `e${index}`).join(", ")}].join();\n}\n` +
        `console.log(apart(1, ${upTo(size, index => index).join(", ")}).length, apart().length);\n`,
    }),
  },
  {
    name: "arguments of one call, each a sum",
    counted: "arguments",
    size: 16000,
    entry: "main.js",
    isExcludedFromCombinedBuild: true,
    write: size => ({
      "main.js": `function take() {\n  return arguments.length;\n}\nfunction give(a) {\n  return take(a, ${upTo(size, index => `a + ${index}`).join(", ")});\n}\nconsole.log(give(1), give("x"));\n`,
    }),
  },
  packagesWithOwnCompilerOptions,
  // In the three shapes below each of so many places has so many callees or classes: what looks at each pair once costs four times as much for twice the size.
  {
    name: "functions in one array that each call whichever the array answers with, with their own arguments",
    counted: "functions",
    size: 300,
    entry: "main.js",
    isExcludedFromCombinedBuild: true,
    counts: ["HandedOnReferencesRead", "FunctionsBelowEntrancesInCyclesVisited"],
    write: size => ({
      "main.js":
        `let kept = null;\n` +
        lines(size, index => `function step${index}(state, other, key) { ${index ? "" : "kept = state; "}return key < 1 ? ${index} : table[key % table.length](state, other, key - 1) + ${index}; }`) +
        `const table = [${upTo(size, index => `step${index}`).join(", ")}];\n` +
        `console.log(${size ? "table[0]({ a: 1 }, { b: 2 }, 3)" : 0}, kept !== null);\n`,
    }),
  },
  {
    name: "classes with a method of one name that each call it on an instance of any of them",
    counted: "classes",
    size: 300,
    entry: "main.js",
    isExcludedFromCombinedBuild: true,
    counts: ["HandedOnReferencesRead", "FunctionsBelowEntrancesInCyclesVisited"],
    write: size => ({
      "main.js":
        `let kept = null;\nconst all = [];\n` +
        lines(size, index => `class Node${index} { visit(state, other, key) { ${index ? "" : "kept = state; "}return key < 1 ? ${index} : all[key % all.length].visit(state, other, key - 1) + ${index}; } }\nall.push(new Node${index}());`) +
        `console.log(${size ? "all[0].visit({ a: 1 }, { b: 2 }, 3)" : 0}, kept !== null);\n`,
    }),
  },
  {
    name: "instances of classes of their own that statements assign to one variable, a method called on it after each",
    counted: "classes",
    size: 200,
    entry: "main.js",
    isExcludedFromCombinedBuild: true,
    counts: ["UnionMembersCompared", "CallOperandsSummarizedForFrames"],
    write: size => ({
      "main.js":
        `let sum = 0;\nlet current = null;\n` +
        lines(size, index => `class Kind${index} { weigh() { return ${index}; } }\nif ((sum & ${index}) == 0) current = new Kind${index}();\nsum += current.weigh();`) +
        `console.log(sum);\n`,
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
