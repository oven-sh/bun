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
  /** Not an entry point of a build of many shapes. */
  isExcludedFromCombinedBuild?: true;
  /** An entry point of the second build of many shapes and not of the first, whose budget was taken without it. */
  isInSecondCombinedBuild?: true;
  /** `entry` is a test file: `bun test --aot` builds it and runs it, so what a test run does in front of its build is counted too. Not an entry point of the build of all shapes. */
  isTestRun?: true;
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

const aFloat64Array = (size: number) =>
  `const list = new Float64Array(${size + 1});\nfor (let i = 0; i < list.length; i++) list[i] = i % 3 ? i % 5 : i % 5 + 0.5;\n`;

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

function functionsOfTheLanguage(count: number) {
  const holders: [string, object][] = [
    ["Math", Math],
    ["Object", Object],
    ["Reflect", Reflect],
    ["Array.prototype", Array.prototype],
    ["String.prototype", String.prototype],
    ["Date.prototype", Date.prototype],
    ["Map.prototype", Map.prototype],
    ["Set.prototype", Set.prototype],
    ["RegExp.prototype", RegExp.prototype],
    ["Promise.prototype", Promise.prototype],
    ["Number.prototype", Number.prototype],
    ["Object.prototype", Object.prototype],
    ["Function.prototype", Function.prototype],
    ["DataView.prototype", DataView.prototype],
    ["ArrayBuffer.prototype", ArrayBuffer.prototype],
    ["WeakMap.prototype", WeakMap.prototype],
    ["WeakSet.prototype", WeakSet.prototype],
    ["Atomics", Atomics],
    ["JSON", JSON],
    ["Array", Array],
    ["Number", Number],
    ["String", String],
    ["Promise", Promise],
  ];
  const named: string[] = [];
  for (const [holder, object] of holders) {
    for (const name of Object.getOwnPropertyNames(object).sort()) {
      if (!/^[A-Za-z][A-Za-z0-9]*$/.test(name) || name === "constructor") continue;
      if (typeof Object.getOwnPropertyDescriptor(object, name)!.value === "function") named.push(`${holder}.${name}`);
    }
  }
  if (named.length <= 256) throw new Error(`only ${named.length} functions of the language: a type once listed 256 built-in objects, and the shape is to pass that`);
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

function recordTypesParsedFromTexts(size: number) {
  const recordsInModule = 100;
  const modules = Math.ceil(size / recordsInModule);
  const files: Record<string, string> = { "tsconfig.json": withoutLibraryTypes };
  for (let module = 0; module < modules; module++) {
    const indexes = upTo(Math.min(recordsInModule, size - module * recordsInModule), index => module * recordsInModule + index);
    files[`part${module}.ts`] =
      indexes.map(index => `interface Taken${index} { field${index}: number; name: string }\nfunction take${index}(taken: Taken${index}): number { return taken.field${index} + taken.name.length; }\n`).join("") +
      `export function run${module}(texts: string[]): number {\n  let sum = 0;\n` +
      indexes.map(index => `  sum += take${index}({ field${index}: ${index}, name: "n" }) + take${index}(JSON.parse(texts[${index}]) as Taken${index});\n`).join("") +
      `  return sum;\n}\n`;
  }
  files["main.ts"] =
    declaredConsole +
    lines(modules, module => `import { run${module} } from "./part${module}.ts";`) +
    `const texts: string[] = [];\nfor (let index = 0; index < ${size}; index++) texts.push('{"field' + index + '":1,"name":"x"}');\n` +
    `console.log(${upTo(modules, module => `run${module}(texts)`).join(" + ") || 0});\n`;
  return files;
}

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
  { name: "CommonJS modules that require one another in a row", counted: "modules", size: 400, entry: "main.js", isInSecondCombinedBuild: true, write: commonJSModulesInARow },
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
  // A tsconfig.json that names no files lists all that lies below it: tests, scripts, other programs. The build looks at each for what it declares for
  // every file and lets it go. Held all at once, the texts of a large repository were gigabytes for a program of one line.
  {
    name: "files of the project that nothing imports",
    counted: "files",
    size: 2000,
    entry: "app/main.ts",
    isExcludedFromCombinedBuild: true,
    write: size => ({
      "tsconfig.json": withoutLibraryTypes,
      "app/main.ts": `${declaredConsole}console.log(1 + 1);\n`,
      ...Object.fromEntries(
        upTo(size, index => [
          `other/f${index}.ts`,
          `export const v${index}: number = ${index};\n` +
            lines(200, line => `export function f${index}_${line}(x: number, y: string): number { return x + y.length + v${index} + ${line}; }`),
        ]),
      ),
    }),
  },
  // `new Worker(holder.path)` is followed to what is stored under `path`, whichever object has it. Each store that holds a read of `path` led to one more
  // walk over all the stores: the load of a large application's tests took minutes on one thread.
  {
    name: "stores under the name that the file of a Worker is read from",
    counted: "stores",
    size: 8000,
    entry: "main.js",
    isInSecondCombinedBuild: true,
    write: size => ({
      "w.js": `postMessage("up");\n`,
      "main.js":
        lines(size, index => `function f${index}(given) { return { path: given.path }; }`) +
        `function spawn(holder) { return new Worker(holder.path); }\n` +
        `const given = { path: new URL("./w.js", import.meta.url).href };\n` +
        `console.log(typeof spawn, [${upTo(size, index => `f${index}`).join(", ")}].filter(f => f(given).path === given.path).length);\n`,
    }),
  },
  // `function spawn(file) { return new Worker(file); }` is followed to what each caller passes, and from a caller's parameter to what its callers pass.
  // Each parameter on the way cost a walk over every expression of the file.
  {
    name: "functions that hand on the file of a Worker",
    counted: "functions",
    size: 4000,
    entry: "main.js",
    isInSecondCombinedBuild: true,
    write: size => ({
      "w.js": `postMessage("up");\n`,
      "main.js":
        `function spawn(file) { return new Worker(file); }\n` +
        lines(size, index => `function f${index}(file) { return spawn(file); }`) +
        `const file = new URL("./w.js", import.meta.url).href;\n` +
        `if (process.argv.length > 9) {\n${lines(size, index => `  f${index}(file);`)}}\n` +
        `console.log(typeof spawn);\n`,
    }),
  },
  // The same functions, each also held in a list: who calls such a function is sought by every way that leads to it, beginning at the mentions of its name.
  // Finding those cost a walk over every expression of the file for each function.
  {
    name: "functions in a list that hand on the file of a Worker",
    counted: "functions",
    size: 4000,
    entry: "main.js",
    isInSecondCombinedBuild: true,
    write: size => ({
      "w.js": `postMessage("up");\n`,
      "main.js":
        `function spawn(file) { return new Worker(file); }\n` +
        lines(size, index => `function f${index}(file) { return spawn(file); }`) +
        `const file = new URL("./w.js", import.meta.url).href;\n` +
        `const all = [${upTo(size, index => `f${index}`).join(", ")}];\n` +
        `if (process.argv.length > 9) {\n${lines(size, index => `  f${index}(file);`)}}\n` +
        `console.log(typeof spawn, all.length);\n`,
    }),
  },
  // A package reads the file of its Worker out of an options object. Other packages, which never get to that one, store under the same name, and what they
  // store is read from more such names. Each start led through every such store of the program: starts x stores.
  {
    name: "files that store under the names that the files of Workers are read from",
    counted: "files",
    size: 1200,
    entry: "main.js",
    isInSecondCombinedBuild: true,
    write: size => {
      const files: Record<string, string> = { "w.js": `postMessage("up");\n` };
      const named = upTo(size, index => (index % 4 === 0 ? `start${index}` : `make${index}`));
      for (let index = 0; index < size; index++) {
        files[`p/p${index}.js`] =
          index % 4 === 0
            ? `export const start${index} = options => new Worker(options.filename);\n`
            : `export const make${index} = given => [\n${lines(10, () => `  { filename: given.name, name: given.description, description: given.args, args: given.options, options: given.filename },`)}];\n`;
      }
      files["main.js"] =
        lines(size, index => `import { ${named[index]} } from "./p/p${index}.js";`) +
        `const all = [${named.join(", ")}];\n` +
        `if (process.argv.length > 9) all[0]({ filename: new URL("./w.js", import.meta.url).href });\n` +
        `console.log(all.length);\n`;
      return files;
    },
  },
  // A test run reads every file in front of its build, to find what the tests replace. `p.mark = 1` asks there what `p` is: some built-in object, perhaps. The way back runs through what a constant
  // is made of and what the callers pass for a parameter, and through `a.b`, `||` and `&&` there. Each write walked that way anew, through every name in front of it: writes x names.
  // It took two minutes over six large package files.
  {
    name: "writes to members of names that are made of the names before them, in a package of a test run",
    counted: "names",
    size: 3000,
    entry: "a.test.js",
    isTestRun: true,
    write: size => ({
      "package.json": `{ "name": "p", "type": "module" }\n`,
      "node_modules/big/package.json": `{ "name": "big", "version": "1.0.0", "type": "module", "main": "index.js" }\n`,
      "node_modules/big/index.js":
        `const a0 = { next: null, mark: -1 };\n` +
        lines(
          size,
          index =>
            `const a${index + 1} = a${index}.next || a${index};\na${index + 1}.mark = ${index};\n` +
            `function g${index}(p) { p.mark = ${index}; }\ng${index}((a${index + 1} && a${index + 1}.next) || a${index + 1});`,
        ) +
        `export const last = a${size}.mark;\n`,
      "a.test.js": `import { expect, test } from "bun:test";\nimport { last } from "big";\ntest("it loads", () => { expect(last).toBe(${size - 1}); });\n`,
    }),
  },
  // The same reading asks of each operand of a call which names it may hold. Where the operand is a call itself, `use(id({ a: 1 }))`, the way runs through what the callee returns, and a parameter
  // that is returned stands for every argument of every call of that helper. Each call walked that way anew: calls x calls. Large package files are full of such helpers, round every require().
  {
    name: "calls that take a call of a helper that returns its parameter, in a package of a test run",
    counted: "calls",
    size: 3000,
    entry: "a.test.js",
    isTestRun: true,
    write: size => ({
      "package.json": `{ "name": "p", "type": "module" }\n`,
      "node_modules/big/package.json": `{ "name": "big", "version": "1.0.0", "type": "module", "main": "index.js" }\n`,
      "node_modules/big/index.js":
        `let total = 0;\nfunction use(v) { total += typeof v === "object" ? 1 : 2; return v; }\nfunction id(x) { return x; }\n` +
        lines(size, index => `use(id({ a${index}: ${index} }));`) +
        `export const count = total;\n`,
      "a.test.js": `import { expect, test } from "bun:test";\nimport { count } from "big";\ntest("it loads", () => { expect(count).toBe(${size}); });\n`,
    }),
  },
  // The same walk needs no large file. Ten layers of small functions, each `return pick(a(x), b(x), c(x))` over three of the layer below, and `pick` returns its parameters:
  // from one call the way through what is returned reaches nearly every call of the file. It grew seven times with each doubling.
  {
    name: "layers of functions that return a pick of three calls of the layer below, in a test run",
    counted: "functions in each of ten layers",
    size: 30,
    entry: "a.test.js",
    isTestRun: true,
    write: size => ({
      "package.json": `{ "name": "p", "type": "module" }\n`,
      "layers.js":
        `function pick(a, b, c) { return a ?? b ?? c; }\n` +
        lines(size, index => `function f0_${index}(a) { return a + ${index}; }`) +
        upTo(9, below =>
          lines(
            size,
            index =>
              `function f${below + 1}_${index}(a) { return pick(f${below}_${index}(a), f${below}_${(index * 7 + 1) % size}(a), f${below}_${(index * 13 + 5) % size}(a)); }`,
          ),
        ).join("") +
        `export const top = ${size ? "f9_0" : "a => a"};\n`,
      "a.test.js": `import { expect, test } from "bun:test";\nimport { top } from "./layers.js";\ntest("it loads", () => { expect(top(1)).toBe(1); });\n`,
    }),
  },
  // To see what an expression names, the front end steps through a call into what the callee returns. Each step copied the lists of what the walk had passed and looked through them from end to end:
  // depth x depth a walk, and a walk starts at each call: 2,000 functions took 143 G instructions where 25 G do. What is left is the sum of the depths: the call of f7 still walks seven deep.
  {
    name: "functions that each return a call of the one before, each called once, in a test run",
    counted: "functions",
    size: 500,
    entry: "a.test.js",
    isTestRun: true,
    write: size => ({
      "package.json": `{ "name": "p", "type": "module" }\n`,
      "a.test.js":
        `import { expect, test } from "bun:test";\nfunction use(x) { return x; }\nfunction f0(x) { return x; }\n` +
        lines(size, index => `function f${index + 1}(x) { return f${index}(x); }`) +
        `let sum = 0;\n` +
        lines(size, index => `sum += use(f${index + 1}({ k: ${index} })).k;`) +
        `test("it adds", () => { expect(sum).toBe(${(size * (size - 1)) / 2}); });\n`,
    }),
  },
  // A test run reads the files that its tests load in rounds: what a round names, the next one reads. A chain of files takes a round for each, and behind every round
  // what the files hand each other was worked out anew for all of them, with a list of the files on the way that was searched at each: 6,000 files took 1,160 G instructions.
  {
    name: "files that each export again what the next exports, in a test run",
    counted: "files",
    size: 750,
    entry: "a.test.js",
    isTestRun: true,
    write: size => ({
      "package.json": `{ "name": "p", "type": "module" }\n`,
      ...Object.fromEntries(upTo(size, index => [`m${index}.js`, `export { x } from "./m${index + 1}.js";\n`])),
      [`m${size}.js`]: `export const x = Math;\n`,
      "a.test.js": `import { expect, test } from "bun:test";\nimport { x } from "./m0.js";\ntest("it loads", () => { expect(x.abs(-1)).toBe(1); });\n`,
    }),
  },
  // Of each export the front end asks which text it holds, and steps from constant to constant. At each step it asked whether the name is `sep` of node:path,
  // which walked the rest of the chain once more: 10,000 constants took 1,924 G instructions as a test run, and 1 G as an executable.
  {
    name: "exported constants that each hold the one before, in a test run",
    counted: "constants",
    size: 1000,
    entry: "a.test.js",
    isTestRun: true,
    write: size => ({
      "package.json": `{ "name": "p", "type": "module" }\n`,
      "constants.js": `export const c0 = Math;\n` + lines(size, index => `export const c${index + 1} = c${index};`),
      "a.test.js": `import { expect, test } from "bun:test";\nimport { c${size} as last } from "./constants.js";\ntest("it loads", () => { expect(last.abs(-1)).toBe(1); });\n`,
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
    counts: ["BlocksReadForDefinitionsThroughTests", "BlocksVisitedForCyclesAvoidingBlocks", "EntriesReadToSeparateLoops", "BlocksReachedToSeeWhatRunsEachTurn"],
    write: size => ({
      "tsconfig.json": withoutLibraryTypes,
      "main.ts": `${declaredConsole}function large(a: any, o: any, r: any[]) {\n${lines(size, index => statements[index % statements.length](index))}}\n${operand}const out: any[] = [];\nlarge([1, 2, 3], o, out);\nconsole.log(out.length);\n`,
    }),
  },
  // Each loop compares its position with the length of the list and stores an object there, which is made between the comparison and the test of the position.
  // Whoever walks the function once for each comparison, or makes its graph anew behind each test that it adds, works by the loop times the function.
  {
    name: "loops that fill one list with objects",
    counted: "loops",
    size: 200,
    entry: "main.js",
    isExcludedFromCombinedBuild: true,
    counts: ["BlocksReadForAccessesBehindComparisons", "AssumptionsReadForIntegerRelations", "LengthsAskedToBoundAccesses", "BlocksReadForDefinitionsThroughTests"],
    write: size => ({
      "main.js":
        "function large(a) {\n" +
        lines(size, index => `  for (let k = 0; k < a.length; k++) a[k] = { v: k + ${index} };`) +
        "  return a;\n}\nconsole.log(large([1, 2, 3]).length);\n",
    }),
  },
  // Each loop reads the list at its position and adds to a sum, so two values go round it, and both come into its block from two sides.
  // Whoever makes a table of the function's blocks for each read, or its graph anew for each loop that he changes, works by the loop times the function.
  {
    name: "loops that read one list",
    counted: "loops",
    size: 200,
    entry: "main.js",
    isExcludedFromCombinedBuild: true,
    counts: ["BlocksReadForDefinitionsThroughTests", "BlocksReadToBuildControlFlowGraphs"],
    write: size => ({
      "main.js":
        "function large(a) {\n  let s = 0;\n" +
        lines(size, index => `  for (let k = 0; k < a.length; k++) s += a[k] + ${index};`) +
        "  return s;\n}\nconsole.log(large([1, 2, 3]));\n",
    }),
  },
  // Every value is made above loops and read below them, and no loop changes it.
  // Whoever keeps a definition of each value at each loop that a read passes, or looks through all that he has found at a loop for each name, works by the value times the loop.
  {
    name: "values that stay live across loops",
    counted: "values",
    size: 1000,
    entry: "main.js",
    isExcludedFromCombinedBuild: true,
    counts: ["BlocksReadToBuildControlFlowGraphs", "FailedTestsReadForSubjects"],
    write: size => ({
      "main.js":
        `const a = [], b = [];\nfor (let i = 0; i < ${size}; i++) { a.push("s" + i); b.push(String.fromCharCode(65 + i % 26) + i); }\n` +
        "function mix(s, v) { return (s * 33 + v) % 1000000007; }\nfunction large(a, b) {\n  let s = 1;\n" +
        lines(size, index => {
          const list = "ba"[index % 2];
          return `  ${index % 3 ? "" : `while (${list} !== ${list}) ${list} = [${list}]; `}const v${index} = ${list}[${index}];`;
        }) +
        lines(size, index => `  ${index % 7 ? "" : "while (s !== s) s = [s]; "}s = mix(s, v${index}.length * 131 + v${index}.charCodeAt(v${index}.length - 1));`) +
        "  return s;\n}\nconsole.log(large(a, b));\n",
    }),
  },
  // Every list is made with the same number, so each loop's comparison with that number may speak of any of them.
  // Whoever walks back to where a list was made before he looks at what is done with it works by the loop times the list times the way between them.
  {
    name: "lists made with one length and filled in loops",
    counted: "lists",
    size: 100,
    entry: "main.js",
    isExcludedFromCombinedBuild: true,
    counts: ["BlocksWalkedInFrontOfListsMadeWithLength"],
    write: size => ({
      "main.js":
        "function large(r, n) {\n" +
        lines(size, index => `  { const l = new Array(n); for (let k = 0; k < n; k++) l[k] = { v: k + ${index} }; r.push(l); }`) +
        "  return r;\n}\nconsole.log(large([], 3).length);\n",
    }),
  },
  // Every statement tests the same two parameters again: whoever asks each test about every other test of the same value asks a million times.
  {
    name: "arrays and objects that one function makes, between calls of what nobody knows",
    counted: "statements",
    size: 500,
    entry: "main.js",
    counts: ["BlocksReadToRaiseFrequencies", "UsesListedBehindTests"],
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
  // Each suspension listed every value that lives across it, and every pass walked those lists.
  {
    name: "awaits in a row, each of a function that is declared before the first",
    counted: "awaits",
    size: 1000,
    entry: "main.mjs",
    isInSecondCombinedBuild: true,
    write: size => ({
      "main.mjs":
        lines(size, index => `async function a${index}(x) { return x + ${index}; }`) +
        `let sum = 0;\n${lines(size, index => `sum += await a${index}(sum & 7);`)}console.log(sum);\n`,
    }),
  },
  // A join "paid" while any join that takes its object was still a candidate, so a row of merge blocks was given up from its far end, one parameter for each analysis of the whole function.
  {
    name: "a row of branches that hand one new object on",
    counted: "branches",
    size: 150,
    entry: "main.js",
    counts: ["ParametersVisitedForNewObjects"],
    write: size => ({
      "main.js": `function row(n) {\n  let o = { a: n, b: 1 };\n${lines(size, index => `  if (n & ${1 << index % 20}) o = { a: o.a + ${index}, b: o.b }; else o.b += ${index};`)}  return o.a + o.b;\n}\nlet sum = 0;\nfor (let i = 0; i < 50; i++) sum += row(i);\nconsole.log(sum);\n`,
    }),
  },
  // What a use means to a cell that may lie in the frame was asked again for each cell that may reach the use: cells x uses.
  {
    name: "a chain of closures that each call the one before",
    counted: "closures",
    size: 40,
    entry: "main.js",
    isExcludedFromCombinedBuild: true,
    counts: ["OperandsSummarizedForFrames"],
    write: size => ({
      "main.js": `function call(f, d) { return d ? call(f, d - 1) : f(); }\nfunction row(n) {\n  let f = () => n;\n${lines(size, index => `  if (n & ${1 << index % 20}) { const g = f; f = () => call(g, 1) + ${index}; }`)}  return call(f, 1);\n}\nlet sum = 0;\nfor (let i = 0; i < 50; i++) sum += row(i);\nconsole.log(sum);\n`,
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
  ...(
    [
      ["functions that call one another at random", 600, undefined],
      // What takes a step for each function on the way each time the way leads back to one of them shows from here on.
      ["very many functions that call one another at random", 4800, true],
    ] as const
  ).map(
    ([name, smallerSize, isExcludedFromCombinedBuild]): Shape => ({
      name,
      counted: "functions",
      size: smallerSize,
      entry: "main.js",
      isExcludedFromCombinedBuild,
      write: size => {
        let seed = 7;
        const next = () => (seed = (seed * 48_271) % 2_147_483_647) % Math.max(size, 1);
        return {
          "main.js":
            lines(size, index => `function f${index}(node, depth) {\n${[0, 1, 2].map(tag => `  if (node.tag === ${tag}) return f${next()}(node.next, depth + ${tag});`).join("\n")}\n  return node.value;\n}`) +
            `console.log(${size ? "f0({ tag: 9, value: 1, next: null }, 0)" : "1"});\n`,
        };
      },
    }),
  ),
  {
    // Whoever follows the calls from one function to the next by recursion runs out of stack on the way round.
    name: "functions that each call the next, and the last the first",
    counted: "functions",
    size: 9600,
    entry: "main.js",
    isExcludedFromCombinedBuild: true,
    write: size => ({
      "main.js":
        lines(size, index => `function f${index}(node, depth) {\n  if (node.tag === 0) return f${(index + 1) % size}(node.next, depth + 1);\n  return node.value;\n}`) +
        `console.log(${size ? "f0({ tag: 9, value: 1, next: null }, 0)" : "1"});\n`,
    }),
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
  // Beyond 4,096 names a read may end what is known of the object. Whether the object escapes at such a read was asked of all its uses.
  {
    name: "names of one large literal",
    counted: "names",
    size: 6000,
    entry: "main.js",
    isExcludedFromCombinedBuild: true,
    write: size => ({
      "main.js": `const table = {\n${lines(size, index => `  name${index}: ${index},`)}};\nlet sum = 0;\n${lines(size, index => `sum += table.name${index};`)}console.log(sum);\n`,
    }),
  },
  // What lies under a name also lies under every name that it is stored again under. Lists of the functions under each name would hold 1, 2, 3 .. of them.
  {
    name: "names that are each stored again under the next",
    counted: "names",
    size: 3000,
    entry: "main.js",
    isExcludedFromCombinedBuild: true,
    write: size => ({
      "main.js":
        lines(
          size,
          index =>
            `function step${index}() {\n  const made = {};\n  made.name${index} = function (x) { return x + ${index}; };\n  const handedOn = {};\n  handedOn.name${index + 1} = made.name${index};\n  return handedOn;\n}`,
        ) +
        `let last = { name0: x => x };\nfor (const step of [${upTo(size, index => `step${index}`).join(", ")}]) last = step();\nconsole.log(last.name${size}(1));\n`,
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
  // Whether an access is split by the parts of its receiver's type goes by what all the accesses of that receiver would gain. That was counted anew at each of them, and each count
  // looked the name up among the fields: 3,200 names read off one object took the pass 9.2 s where 1,600 took 1.8.
  {
    name: "names that one loop reads off one object of two layouts",
    counted: "names",
    size: 800,
    entry: "main.js",
    isInSecondCombinedBuild: true,
    write: size => ({
      "main.js": `let notes = 0;\nfunction note(v) { notes += v; }\nfunction run(o, n) {\n  let s = 0;\n  for (let i = 0; i < n; i++) {\n${lines(size, index => `    s = (s + o.table${index}[i & 3]) | 0;\n    if (s === ${-7 - 0} - ${index}) note(s);`)}  }\n  return s;\n}\nconst fields = () => ({ ${upTo(size, index => `table${index}: [1, 2, 3, ${index}]`).join(", ")} });\nconst holders = [fields(), Object.assign(Object.create(null), fields(), { more: 1 })];\nlet t = 0;\nfor (let r = 0; r < 40; r++) t += run(holders[r & 1], 50);\nconsole.log(t, notes);\n`,
    }),
  },
  // A hot loop gets a copy for its unlikely paths, which is entered wherever one of them leaves. What the loop has made by then joins what the copy makes there. With n sums, each with a
  // path that leaves, that is n x n parameters. Behind a limit on the size of the loop nobody saw it; without the limit 1,280 sums took 28 s where 640 took 6.
  {
    name: "sums that one hot loop carries",
    counted: "sums",
    size: 1000,
    entry: "main.js",
    counts: ["PhiPlacementSteps"],
    isInSecondCombinedBuild: true,
    write: size => ({
      "main.js": `function run(a, n) {\n${lines(size, index => `  let s${index} = 0;`)}  for (let i = 0; i < n; i++) {\n${lines(size, index => `    s${index} += (i ^ ${index}) + a[(i + ${index}) & 7];`)}  }\n  return 0${upTo(size, index => ` + s${index}`).join("")};\n}\nconst a = [1, 2, 3, 4, 5, 6, 7, 8];\nlet t = 0;\nfor (let r = 0; r < 50; r++) t += run(a, 200);\nconsole.log(t);\n`,
    }),
  },
  // Each read and each `%` has a call on a rare path, and every value lives across thousands of them. A live range is split around the calls that it crosses, with a value of its own for
  // each call. On rare paths that costs next to nothing by the frequencies, so the register allocator walked all the calls for each value and register, and made 2,000,000 values for 8,000.
  // 34,000 values took 354 s and 3.6 GB where 27 s and 1.1 GB do, and on arm64 the list of values passed 4 GB.
  {
    name: "values that live across calls on rare paths",
    counted: "values",
    size: 8000,
    entry: "main.js",
    isInSecondCombinedBuild: true,
    write: size => ({
      "main.js": `const a = new Float64Array(${size + 1}), b = new Int32Array(${size + 1});\nfor (let i = 0; i < ${size}; i++) { a[i] = i + 0.5; b[i] = i * 3; }\nfunction mix(s, v) { return (s * 33 + v) % 1000000007; }\nfunction run(a, b) {\n  let s = 1;\n${lines(size, index => `  const v${index} = ${index & 1 ? "a" : "b"}[${index}];`)}${lines(size, index => `  s = mix(s, v${index} * 2);`)}  return s;\n}\nconsole.log(run(a, b));\n`,
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
  // Each call leads to the handler by a rare edge. To place a rare block, the order of blocks went through all that lead to it, once for each of them.
  {
    name: "calls of what nobody knows under one try",
    counted: "calls",
    size: 3000,
    entry: "main.js",
    isInSecondCombinedBuild: true,
    counts: ["PredecessorsVisitedForRareBlocks"],
    write: size => ({
      "main.js": `const seed = process.argv.length;\nconst h = [x => (x * 31 + seed) % 1009, x => x + seed][seed % 2];\nfunction run() {\n  let n = 0;\n  try {\n${lines(size, index => `    n += h(n + ${index});`)}  } catch (e) {\n    n = -1;\n  }\n  return n;\n}\nconsole.log(run());\n`,
    }),
  },
  // `v = null` lets go of an object, and every register and stack slot that still holds it is cleared. To find them, a walk went back from each such statement to where the object came from.
  {
    name: "variables that hold objects across many calls and are set to null at the end",
    counted: "calls",
    size: 2000,
    entry: "main.js",
    isExcludedFromCombinedBuild: true,
    counts: ["DeadValueReleaseSteps"],
    write: size => ({
      "main.js":
        "const seed = process.argv.length;\nconst h = [x => (x * 31 + seed) % 1009, x => x + seed][seed % 2];\nconst held = [{ a: 1 }, { a: 2 }, { a: 3 }];\nfunction run() {\n  let n = 0;\n" +
        lines(size >> 2, index => `  let v${index} = held[(seed + ${index}) % 3];`) +
        (size ? lines(size, index => `  n += h(n + v${index % (size >> 2)}.a);`) : "") +
        lines(size >> 2, index => `  v${index} = null; n += h(${index});`) +
        "  return n;\n}\nconsole.log(run());\n",
    }),
  },
  {
    name: "statements that branch in one loop and a variable that is set to null behind it",
    counted: "statements",
    size: 200,
    entry: "main.js",
    isExcludedFromCombinedBuild: true,
    counts: ["DeadValueReleaseSteps", "BlocksReadForLoopsInsideLoops"],
    write: size => ({
      "main.js":
        "const seed = process.argv.length;\nconst h = [x => (x * 31 + seed) % 1009, x => x + seed][seed % 2];\nconst held = [{ a: 1 }, { a: 2 }, { a: 3 }];\nfunction run(k) {\n  let n = 0;\n  let v = held[seed % 3];\n  n += h(n + v.a);\n  for (let t = 0; t < 2; t++) {\n" +
        lines(size, index => `    if (k > ${index}) n += h(${index}); else n -= ${index};`) +
        "  }\n  n += h(n + v.a);\n  v = null;\n  n += h(n);\n  return n;\n}\nconsole.log(run(seed));\n",
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
    isInSecondCombinedBuild: true,
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
  // What a function returns is proven once that is proven of the function whose result it returns: a turn a function, and no turn may look at all of them.
  {
    name: "functions that each return what the next returns, and one more",
    counted: "functions",
    size: 2000,
    entry: "main.js",
    counts: ["ParametersHandedOnRead"],
    // Nothing besides: it stays out of the build of all shapes, whose budget was counted without it.
    flags: [],
    write: size => ({
      "main.js":
        lines(size, index => `function f${index}(x) { return f${index + 1}(x) + 1; }`) +
        `function f${size}(x) { return x | 0; }\nconsole.log(f0(1));\n`,
    }),
  },
  {
    name: "classes with a field and a method each that extend one another in a row",
    counted: "classes",
    size: 500,
    entry: "main.js",
    flags: [],
    write: size => ({
      "main.js":
        `class C0 { f0 = 0; m() { return 0; } }\n` +
        lines(size, index => `class C${index + 1} extends C${index} { f${index + 1} = ${index + 1}; m() { return super.m() + 1; } }`) +
        `console.log(new C${size}().m());\n`,
    }),
  },
  {
    name: "methods of one name that each call the method above, up a row of classes",
    counted: "classes",
    size: 500,
    entry: "main.js",
    flags: [],
    write: size => ({
      "main.js":
        `class C0 { m() { return 0; } }\n` +
        lines(size, index => `class C${index + 1} extends C${index} { m() { return super.m() + 1; } }`) +
        `console.log(new C${size}().m());\n`,
    }),
  },
  // What lies above a class is found link by link, and each link that is found is one more object above every class further down.
  // A store to `this` may run into an accessor of any class above. Each class of a row asked its whole row, so 4,000 classes cost a third more than they do.
  {
    name: "classes that each store to this and extend one another in a row",
    counted: "classes",
    size: 1000,
    entry: "main.js",
    // Nothing besides: it stays out of the build of all shapes, whose budget was counted without it.
    flags: [],
    write: size => ({
      "main.js": `class C0 { constructor() { this.f0 = 0; } }\n${lines(Math.max(size - 1, 0), index => `class C${index + 1} extends C${index} { constructor() { super(); this.f${(index + 1) % 50} = ${index + 1}; } }`)}console.log(Object.keys(new C${Math.max(size - 1, 0)}()).length);\n`,
    }),
  },
  // The same below a class with an accessor: whether a store runs into it was asked by a walk up the whole row from every class.
  {
    name: "classes that each store to this, in a row below a class with an accessor",
    counted: "classes",
    size: 1000,
    entry: "main.js",
    // Nothing besides: it stays out of the build of all shapes, whose budget was counted without it.
    flags: [],
    write: size => ({
      "main.js": `class C0 { set size(v) { this.kept = v; } get size() { return this.kept; } constructor() { this.f0 = 0; } }\n${lines(Math.max(size - 1, 0), index => `class C${index + 1} extends C${index} { constructor() { super(); this.f${(index + 1) % 50} = ${index + 1}; } }`)}const o = new C${Math.max(size - 1, 0)}();\nconsole.log(Object.keys(o).length, o.size, o.kept);\n`,
    }),
  },
  {
    name: "classes without members that extend one another in a row",
    counted: "classes",
    size: 1000,
    entry: "main.js",
    // Nothing besides: it stays out of the build of all shapes, whose budget was counted without it.
    flags: [],
    write: size => ({
      "main.js": `class C0 {}\n` + lines(size, index => `class C${index + 1} extends C${index} {}`) + `console.log(new C${size}() instanceof C0);\n`,
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
    counts: ["ValuesReadForClassesBelowCopies"],
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
    isInSecondCombinedBuild: true,
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
    isInSecondCombinedBuild: true,
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
    isInSecondCombinedBuild: true,
    write: size => ({
      "main.js": `let sum = 0;\n${lines(size, index => `function f${index}() {\n  const c0 = ${index};\n${lines(24, step => `  const c${step + 1} = c${step} + c${step};`)}  return c24;\n}\nsum += f${index}();`)}console.log(sum);\n`,
    }),
  },
  {
    name: "rows of constants that are each named after the one before, at the top of a file and in a function",
    counted: "constants in each row",
    size: 3000,
    entry: "main.js",
    isInSecondCombinedBuild: true,
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
    isInSecondCombinedBuild: true,
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
    isInSecondCombinedBuild: true,
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
    counts: ["ValuesReadForClassesBelowCopies", "MembersReadForTypesOfCopies"],
    isInSecondCombinedBuild: true,
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
      ["names that a list pattern takes from a typed array or a list", 1000, (index: number) => `e${index}`, "", "", undefined],
      ["names with defaults that a list pattern takes from a typed array or a list", 1000, (index: number) => `e${index} = ${index}`, "", "", ["LinksReadBetweenWebs"]],
      ["names that a list pattern takes from a typed array or a list, in front of a rest element", 1000, (index: number) => `e${index}`, ", ...more", " + more.length", undefined],
      // What takes a step for each name at each name shows from here on.
      ["very many names that a list pattern takes from a typed array or a list", 8000, (index: number) => `e${index}`, "", "", ["LinksReadBetweenWebs"]],
    ] as const
  ).map(
    ([name, smallerSize, element, rest, readsRest, counts]): Shape => ({
      name,
      counted: "names",
      size: smallerSize,
      entry: "main.js",
      isExcludedFromCombinedBuild: true,
      counts: counts && [...counts],
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
    counts: ["UnionMembersCompared", "OperandsSummarizedForFrames"],
    write: size => ({
      "main.js":
        `let sum = 0;\nlet current = null;\n` +
        lines(size, index => `class Kind${index} { weigh() { return ${index}; } }\nif ((sum & ${index}) == 0) current = new Kind${index}();\nsum += current.weigh();`) +
        `console.log(sum);\n`,
    }),
  },
  {
    name: "statements that store a text under one name of one object",
    counted: "statements",
    size: 5000,
    entry: "main.js",
    isExcludedFromCombinedBuild: true,
    write: size => ({
      "main.js": `const held = {};\nlet last = "";\nheld.value = "";\n${lines(size, index => `held.value = last = "text${index}";`)}console.log(held.value.length, last.length);\n`,
    }),
  },
  {
    name: "statements that store a text under one name of exports",
    counted: "statements",
    size: 5000,
    entry: "main.cjs",
    isExcludedFromCombinedBuild: true,
    write: size => ({
      "main.cjs": `let last = "";\nexports.value = "";\n${lines(size, index => `exports.value = last = "text${index}";`)}console.log(exports.value.length, last.length);\n`,
    }),
  },
  {
    name: "statements of a method that store a text under one name of this",
    counted: "statements",
    size: 5000,
    entry: "main.js",
    isExcludedFromCombinedBuild: true,
    write: size => ({
      "main.js": `class Held {\n  fill() {\n    let last = "";\n    this.value = "";\n${lines(size, index => `    this.value = last = "text${index}";`)}    return last;\n  }\n}\nconst held = new Held();\nconsole.log(held.fill().length, held.value.length);\n`,
    }),
  },
  {
    name: "statements that store a text under one name of a function, in a typed file",
    counted: "statements",
    size: 5000,
    entry: "main.ts",
    isExcludedFromCombinedBuild: true,
    write: size => ({
      "tsconfig.json": withoutLibraryTypes,
      "main.ts": `${declaredConsole}function held() {}\nlet last = "";\nheld.value = "";\n${lines(size, index => `held.value = last = "text${index}";`)}console.log(held.value.length, last.length);\n`,
    }),
  },
  {
    name: "template literals that each name the constant before",
    counted: "constants",
    size: 4000,
    entry: "main.js",
    isExcludedFromCombinedBuild: true,
    write: size => ({
      "main.js": `const name0 = "node:path";\n${lines(size, index => `const name${index + 1} = \`\${name${index}}\`;`)}console.log(require(name${size}).sep);\n`,
    }),
  },
  {
    name: "cases of one switch that each return another number",
    counted: "cases",
    size: 4000,
    entry: "main.ts",
    isExcludedFromCombinedBuild: true,
    write: size => ({
      "tsconfig.json": withoutLibraryTypes,
      "main.ts": `${declaredConsole}function kind(x: number) {\n  switch (x) {\n${lines(size, index => `    case ${index}:\n      return ${3 * index + 1};`)}    default:\n      return -5;\n  }\n}\nlet sum = 0;\nfor (let i = -2; i < ${size} + 2; i++) sum += kind(i);\nconsole.log(sum);\n`,
    }),
  },
  {
    name: "objects with a method each that one object literal holds under names of their own",
    counted: "objects",
    size: 5000,
    entry: "main.js",
    isExcludedFromCombinedBuild: true,
    write: size => ({
      "main.js": `const table = {\n${lines(size, index => `  key${index}: { id: ${index}, name: "text${index}", run(a) { return a + ${index}; } },`)}};\nconsole.log(Object.keys(table).length);\n`,
    }),
  },
  {
    name: "texts of one union type, each a case of one switch",
    counted: "texts",
    size: 5000,
    entry: "main.ts",
    isExcludedFromCombinedBuild: true,
    write: size => ({
      "tsconfig.json": withoutLibraryTypes,
      "main.ts":
        `${declaredConsole}type Kind = ${upTo(Math.max(size, 1), index => `"text${index}"`).join(" | ")};\nconst all: Kind[] = [${upTo(size, index => `"text${index}"`).join(", ")}];\n` +
        `function weigh(kind: Kind): number {\n  switch (kind) {\n${lines(size, index => `    case "text${index}":\n      return ${index};`)}  }\n  return -1;\n}\nlet sum = 0;\nfor (const kind of all) sum += weigh(kind);\nconsole.log(sum);\n`,
    }),
  },
  {
    name: "members of one enum, each a case of one switch",
    counted: "members",
    size: 5000,
    entry: "main.ts",
    isExcludedFromCombinedBuild: true,
    write: size => ({
      "tsconfig.json": withoutLibraryTypes,
      "main.ts":
        `${declaredConsole}enum Kind {\n${lines(size, index => `  M${index} = ${index},`)}  Last,\n}\n` +
        `function name(kind: Kind): string {\n  switch (kind) {\n${lines(size, index => `    case Kind.M${index}:\n      return "text${index}";`)}  }\n  return "";\n}\nconsole.log(name(Kind.Last).length);\n`,
    }),
  },
  {
    name: "list literals that each hold what was read from the one before, in front of one branch",
    counted: "literals",
    size: 4000,
    entry: "main.js",
    isExcludedFromCombinedBuild: true,
    write: size => ({
      "main.js": `const v0 = 1;\n${lines(size, index => `const v${index + 1} = [v${index}][0];`)}if (v${size}) console.log(1);\nelse console.log(2);\n`,
    }),
  },
  {
    name: "objects with a method each in the array literal that a function makes",
    counted: "objects",
    size: 5000,
    entry: "main.js",
    isExcludedFromCombinedBuild: true,
    write: size => ({
      "main.js": `function make(x) {\n  return [\n${lines(size, index => `    { id: x, run() { return ${index}; } },`)}  ];\n}\nconsole.log(make(1).length);\n`,
    }),
  },
  {
    name: "names of one object literal that a function fills with its argument",
    counted: "names",
    size: 10000,
    entry: "main.js",
    isExcludedFromCombinedBuild: true,
    write: size => ({
      "main.js": `function make(x) {\n  return {\n${lines(size, index => `    key${index}: x,`)}  };\n}\nconsole.log(Object.keys(make(1)).length);\n`,
    }),
  },
  {
    name: "lines that each add a number and a text to one text, all of them known",
    counted: "lines",
    size: 10000,
    entry: "main.ts",
    isExcludedFromCombinedBuild: true,
    write: size => ({
      "tsconfig.json": withoutLibraryTypes,
      "main.ts": `${declaredConsole}function atTheEnd(a: string, n: number): string {\n  let s = a;\n${"  s = s + n + a;\n".repeat(size)}  return s;\n}\nconsole.log(atTheEnd("x", 1).length);\n`,
    }),
  },
  {
    name: "lines that each add a number and a text to one text, all of them known, and hand it to a function",
    counted: "lines",
    size: 5000,
    entry: "main.ts",
    isExcludedFromCombinedBuild: true,
    write: size => ({
      "tsconfig.json": withoutLibraryTypes,
      "main.ts": `${declaredConsole}let seen = 0;\nfunction use(text: string) {\n  seen += text.length;\n}\nfunction atTheEnd(a: string, n: number): string {\n  let s = a;\n${"  s = s + n + a;\n  use(s);\n".repeat(size)}  return s;\n}\nconsole.log(atTheEnd("x", 1).length, seen);\n`,
    }),
  },
  {
    name: "names stored on one object that are each read and stored again on another",
    counted: "names",
    size: 6000,
    entry: "main.js",
    isExcludedFromCombinedBuild: true,
    write: size => ({
      "main.js":
        `const made = {};\nconst copied = {};\n` +
        lines(size, index => `made.name${index} = function (x) { return x + ${index}; };\ncopied.name${index + 1} = made.name${index};`) +
        `console.log(${size ? `copied.name${size}(1)` : 0});\n`,
    }),
  },
  // Code from disk may write half of the objects, so little is known about what a read finds, and the one large block is full of tests and of writers that end them.
  {
    name: "objects made at top level, half of them handed to code from disk, and read by names of their own",
    counted: "objects",
    size: 3000,
    entry: "main.cjs",
    // Without Bun's own modules, which such a program would hold all of: they are most of the build and none of the question.
    flags: ["--aot-allow-code-from-disk", "--no-builtin-modules"],
    write: size => ({
      "main.cjs":
        `const kept = [], handedOut = [];\nlet sum = 0;\nfunction use(value) { sum += typeof value === "number" ? value : 0; }\n` +
        lines(size, index => `const object${index} = { own${index}: ${index} }; ${index & 1 ? "kept" : "handedOut"}.push(object${index});`) +
        `globalThis.handedOut = handedOut;\ntry { require(process.argv[2]); } catch {}\n` +
        `function pick(which) { return which & 1 ? kept[(which >> 1) % kept.length] : handedOut[(which >> 1) % handedOut.length]; }\n` +
        lines(Math.ceil(size / 10), index => `use(pick(${index * 10 + 1}).own${index * 10 + 1});`) +
        `console.log(sum);\n`,
    }),
  },
  // An array that grows by push has the union of what was pushed for its element type, and each push reduces that union anew: the new member is held against all the others.
  {
    name: "classes with the same fields, an object of each pushed into one array",
    counted: "classes",
    size: 500,
    entry: "main.js",
    isInSecondCombinedBuild: true,
    write: size => ({
      "main.js":
        lines(size, index => `class C${index} {\n  constructor() {\n${lines(8, field => `    this.field${field} = ${index} + ${field};`)}  }\n}`) +
        `const all = [];\n` +
        lines(size, index => `all.push(new C${index}());`) +
        `let sum = 0;\nfor (const one of all) sum += one.field0 + one.field7;\nconsole.log(sum);\n`,
    }),
  },
  {
    name: "entry points that a pattern finds",
    counted: "entry points",
    size: 1000,
    entry: "main.ts",
    flags: ["./pages/*.ts"],
    write: size => ({
      "main.ts": `console.log("main");\n`,
      "pages/first.ts": `console.log("first");\n`,
      ...Object.fromEntries(upTo(size, index => [`pages/page${index}.ts`, `console.log(${index});\n`])),
    }),
  },
  {
    // What a parameter without a type is used as is what the next function uses it as, and so on down the chain: a tree as high as the chain is long, up to the
    // limit on such a tree. Two of them are merged in every function.
    name: "untyped functions in a row that each hand their parameters and a member of one to the next",
    counted: "functions",
    size: 1500,
    entry: "main.js",
    isExcludedFromCombinedBuild: true,
    write: size => ({
      "main.js": `${lines(size, index => `function f${index}(p, q) { p.mark = 0; return f${index + 1}(p.next || q, q && p); }`)}function f${size}(p, q) { return p; }\nconsole.log(typeof f0({ next: null }, { next: null }));\n`,
    }),
  },
  {
    name: "a chain of conditional types",
    counted: "conditional types",
    size: 10000,
    entry: "main.ts",
    isExcludedFromCombinedBuild: true,
    write: size => ({
      "tsconfig.json": withoutLibraryTypes,
      "main.ts": `${declaredConsole}type Chain<X> = ${upTo(size, index => `X extends ${index} ? ${index} : `).join("")}never;\nconst one: Chain<1> | 0 = 0;\nconsole.log(one);\n`,
    }),
  },
  {
    name: "operands of one && that are parameters, numbers and conversions to int32",
    counted: "operands",
    size: 4000,
    entry: "main.js",
    isExcludedFromCombinedBuild: true,
    write: size => {
      // In no regular order, and with a conversion first: each parameter is then tested again and again.
      let seed = 1;
      const draw = (below: number) => (seed = (seed * 48271) % 2147483647) % below;
      const operands = upTo(size, index => (draw(4) ? ["a", "b", "c", "(a | 0)", "(b >>> 0)"][draw(5)] : `${index}${draw(2) ? ".5" : ""}`));
      return { "main.js": `function all(a, b, c) {\n  return ${operands.join(" && ") || "a"};\n}\nconsole.log(all(1, 2, 3), all(2147483647, -2147483648, 1), all(0.5, -0, null), all(-0, -0, -0));\n` };
    },
  },
  // Its budget was restated once, on 10-31: 11,481 M and 259 MB were taken while a loop of over 4 KB got no copy of its unlikely paths. That cap is gone, and the
  // second loop, whose sum may leave int32, is there twice: 14,210 M in a direct build, 11,332 M with SeparateUnlikelyLoopPaths off. Nothing in it grows faster than the shape.
  {
    name: "parts that two loops join to the key of a table",
    counted: "parts",
    size: 4000,
    entry: "main.ts",
    isExcludedFromCombinedBuild: true,
    write: size => {
      const key = ['""', ...upTo(size, index => (index % 7 === 6 ? `"p${index}"` : ["i", "`${b}`", '":"', "a.slice(1)", "b", '"-"', "a", "(i % 3)"][index % 8]))].join(" + ");
      return {
        "tsconfig.json": withoutLibraryTypes,
        "main.ts": `${declaredConsole}function look(a: any, b: any) {\n  const table: any = {};\n  for (let i = 0; i < 40; i++) table[${key}] = i;\n  let found = 0;\n  for (let i = 0; i < 40; i++) found += table[${key}] ?? -100;\n  return found;\n}\nconsole.log(look("xy", "z"), look("", ""));\n`,
      };
    },
  },
  {
    name: "loops nested in one another",
    counted: "loops",
    size: 200,
    entry: "main.js",
    isExcludedFromCombinedBuild: true,
    write: size => ({
      "main.js":
        `function run() {\n  let sum = 0;\n` +
        lines(size, index => `for (let i${index} = 0; i${index} < 1; i${index}++) {`) +
        `sum++;\n${"}\n".repeat(size)}  return sum;\n}\nconsole.log(run());\n`,
    }),
  },
  {
    name: "loops that test at their end, nested in one another",
    counted: "loops",
    size: 200,
    entry: "main.js",
    isExcludedFromCombinedBuild: true,
    write: size => ({
      "main.js":
        `function run() {\n  let sum = 0;\n` +
        lines(size, index => `let i${index} = 0; do {`) +
        `sum++;\n` +
        lines(size, index => `} while (++i${size - 1 - index} < 1);`) +
        `  return sum;\n}\nconsole.log(run());\n`,
    }),
  },
  {
    name: "try statements with a finally block, nested in one another",
    counted: "try statements",
    size: 150,
    entry: "main.ts",
    isExcludedFromCombinedBuild: true,
    write: size => ({
      "tsconfig.json": withoutLibraryTypes,
      "main.ts": `${declaredConsole}function run(): number {\n  let sum = 0;\n${"try {\n".repeat(size)}sum++;\n${"} finally { sum++; }\n".repeat(size)}  return sum;\n}\nconsole.log(run());\nexport {};\n`,
    }),
  },
  {
    name: "fields of one class that methods read and store, in a build without the results of the analysis",
    counted: "fields",
    size: 500,
    entry: "main.ts",
    // Without Bun's own modules, which such a build holds all of.
    flags: [buildFlags.withoutFlowResults, buildFlags.withoutBuiltinModules],
    write: size => ({
      "tsconfig.json": withoutLibraryTypes,
      "main.ts":
        `${declaredConsole}function add(list: number[]): number {\n  let sum = 0;\n  for (const n of list) sum += n;\n  return sum;\n}\nclass Large {\n` +
        lines(size, index => `  n${index}: number;`) +
        `  o: { x: number } = { x: 1 };\n  constructor() {\n` +
        lines(size, index => `    this.n${index} = ${index} + 0.5;`) +
        `  }\n  sum(): number {\n    return add([\n` +
        lines(size, index => `      this.n${index},`) +
        `      this.o.x,\n    ]);\n  }\n  bump(): void {\n` +
        lines(size, index => `    this.n${index} += 1;`) +
        `  }\n}\nconst large = new Large();\nlarge.bump();\nconsole.log(large.sum());\nexport {};\n`,
    }),
  },
  {
    name: "objects that a generator is sent, in one array literal",
    counted: "yields",
    size: 1000,
    entry: "main.js",
    isExcludedFromCombinedBuild: true,
    write: size => ({
      "main.js":
        `function* all() {\n  return [${upTo(size, index => `yield ${index}`).join(", ")}];\n}\n` +
        `let count = 0;\nconst steps = all();\nlet step;\nwhile (!(step = steps.next({ count })).done) count++;\nconsole.log(count, step.value.length);\n`,
    }),
  },
  {
    name: "awaited calls in one array literal",
    counted: "awaits",
    size: 1000,
    entry: "main.mjs",
    isExcludedFromCombinedBuild: true,
    write: size => ({
      "main.mjs":
        `function make(x) {\n  return globalThis.asText ? String(x) : { x };\n}\n` +
        `async function all() {\n  return [${upTo(size, index => `await make(${index})`).join(", ")}];\n}\nconsole.log((await all()).length);\n`,
    }),
  },
  // The variable of the loop holds one more of the objects each time the analysis goes round, and what is read off it is asked for anew.
  {
    name: "objects that each hold the one before, walked by a loop",
    counted: "objects",
    size: 800,
    entry: "main.js",
    isExcludedFromCombinedBuild: true,
    write: size => ({
      "main.js": `let head = null;\n${lines(size, index => `head = { next: head, v${index % 7}: ${index} };`)}let count = 0;\nfor (let at = head; at; at = at.next) count++;\nconsole.log(count);\n`,
    }),
  },
  {
    name: "objects that each hold the one before, walked by a loop that stores into them",
    counted: "objects",
    size: 800,
    entry: "main.js",
    isExcludedFromCombinedBuild: true,
    write: size => ({
      "main.js": `let head = null;\n${lines(size, index => `head = { next: head, v${index % 7}: ${index} };`)}let count = 0;\nfor (let at = head; at; at = at.next) at.place = count++;\nconsole.log(count, head?.place);\n`,
    }),
  },
  {
    name: "object literals nested in one another, walked by a loop",
    counted: "levels",
    size: 800,
    entry: "main.js",
    isExcludedFromCombinedBuild: true,
    write: size => ({
      "main.js": `const outmost = ${"{ inner: ".repeat(size)}1${" }".repeat(size)};\nlet depth = 0;\nfor (let at = outmost; typeof at === "object"; at = at.inner) depth++;\nconsole.log(depth);\n`,
    }),
  },
  {
    name: "object literals nested in one another, each beside smaller literals",
    counted: "levels",
    size: 800,
    entry: "main.js",
    isExcludedFromCombinedBuild: true,
    write: size => ({
      "main.js": `const unit = { width: 1 };\nconst outmost = ${"{ small: { x: unit.width }, list: [unit.width, { y: 2 }], inner: ".repeat(size)}1${" }".repeat(size)};\nlet depth = 0;\nfor (let at = outmost; typeof at === "object"; at = at.inner) depth++;\nconsole.log(depth);\n`,
    }),
  },
  {
    name: "object literals nested in one another, handed to a generic function",
    counted: "levels",
    size: 800,
    entry: "main.ts",
    isExcludedFromCombinedBuild: true,
    write: size => ({
      "main.ts": `function same<T>(value: T): T {\n  return value;\n}\nconst outmost = same(${"{ inner: ".repeat(size)}1${" }".repeat(size)});\nconsole.log(typeof outmost);\n`,
    }),
  },
  {
    name: "object literals nested in one another, handed to a function that keeps them constant",
    counted: "levels",
    size: 800,
    entry: "main.ts",
    isExcludedFromCombinedBuild: true,
    write: size => ({
      "main.ts": `function keep<const T>(value: T): T {\n  return value;\n}\nconst outmost = keep(${"{ inner: ".repeat(size)}1${" }".repeat(size)});\nconsole.log(typeof outmost);\n`,
    }),
  },
  // Data nests 2,000 levels deep at the most: code builds the levels around that.
  {
    name: "object literals nested in one another, more deeply than data may be",
    counted: "levels",
    size: 1600,
    entry: "main.js",
    isExcludedFromCombinedBuild: true,
    write: size => ({
      "main.js": `const outmost = ${"{ inner: ".repeat(size)}1${" }".repeat(size)};\nconsole.log(typeof outmost.inner);\n`,
    }),
  },
  {
    name: "object literals nested in one another, where a declared type takes itself or a number",
    counted: "levels of each of five literals",
    size: 800,
    entry: "main.ts",
    isExcludedFromCombinedBuild: true,
    write: size => {
      const nest = `${"{ inner: ".repeat(size + 1)}1${" }".repeat(size + 1)}`;
      return {
        "main.ts": `interface Level {
  inner: Level | number;
}
type Nest = { inner: Nest } | number;
function kindOf(level: Level) {
  return typeof level.inner;
}
class Holder {
  held: Level = ${nest};
  made(): Level {
    return ${nest};
  }
}
const outmost: Level = ${nest};
const aliased: Nest = ${nest};
const holder = new Holder();
console.log(typeof outmost.inner, typeof aliased, kindOf(${nest}), kindOf(holder.held), kindOf(holder.made()));
`,
      };
    },
  },
  // Code builds each level, and asks at each whether what lies inside may be stored there.
  {
    name: "object literals nested in one another with a spread at each level, where a declared type takes itself or a number",
    counted: "levels",
    size: 800,
    entry: "main.ts",
    isExcludedFromCombinedBuild: true,
    write: size => ({
      "main.ts": `interface Level {
  inner: Level | number;
  beside?: number;
}
const outmost: Level = ${"{ ...{ beside: 1 }, inner: ".repeat(size + 1)}1${" }".repeat(size + 1)};
console.log(typeof outmost.inner);
`,
    }),
  },
  {
    name: "literals that each spread the one before",
    counted: "literals",
    size: 500,
    entry: "main.js",
    isExcludedFromCombinedBuild: true,
    write: size => ({
      "main.js": `const o0 = { a: 0 };\n${lines(size, index => `const o${index + 1} = { ...o${index}, a: ${index} };`)}console.log(o${size}.a);\n`,
    }),
  },
  // Every key is read off one and the same receivers. Their layouts are looked for once, not once for each key.
  {
    name: "literals that merge defaults with a parsed text, a key of each read off any of them",
    counted: "literals, and as many keys",
    size: 100,
    entry: "main.js",
    isExcludedFromCombinedBuild: true,
    counts: ["LayoutsFoundForKeysRead"],
    write: size => ({
      "main.js":
        `const hub = [];\nconst parse = text => JSON.parse(text);\nconst defaults = { host: "localhost", port: 80 };\n` +
        lines(size, index => `function copy${index}(text) { return { ...defaults, ...parse(text) }; }`) +
        lines(size, index => `hub.push(copy${index}('{"k${index}":${index}}'));`) +
        `let sum = 0;\n` +
        lines(size, index => `sum += hub[${index}].k${index} ?? 0;`) +
        `console.log(sum, hub.length);\n`,
    }),
  },
  {
    name: "record types that typed functions take, each parsed from a text",
    counted: "record types, and as many calls of JSON.parse",
    size: 300,
    entry: "main.ts",
    isExcludedFromCombinedBuild: true,
    counts: ["FlowReaders"],
    write: recordTypesParsedFromTexts,
  },
  {
    name: "branches in a row that each assign another function to one variable",
    counted: "branches",
    size: 3000,
    entry: "main.js",
    isExcludedFromCombinedBuild: true,
    write: size => ({
      "main.js":
        lines(size + 1, index => `function f${index}() { return ${index}; }`) +
        `function pick(n) {\n  let picked = f0;\n${lines(size, index => `  if (n > ${index + 1}) picked = f${index + 1};`)}  return picked;\n}\nconsole.log(pick(process.argv.length)());\n`,
    }),
  },
  {
    name: "cases of one switch that each assign another text to one variable",
    counted: "cases",
    size: 3000,
    entry: "main.js",
    isExcludedFromCombinedBuild: true,
    write: size => ({
      "main.js": `function pick(n) {\n  let picked = "t";\n  switch (n) {\n${lines(size, index => `    case ${index}: picked = "t${index}"; break;`)}  }\n  return picked;\n}\nconsole.log(pick(process.argv.length));\n`,
    }),
  },
  {
    name: "branches in a row that each assign another function of the language to one variable",
    counted: "branches",
    size: 3000,
    entry: "main.js",
    isExcludedFromCombinedBuild: true,
    write: size => {
      const named = functionsOfTheLanguage(size + 1);
      return {
        "main.js": `function pick(n) {\n  let picked = ${named[0]};\n${lines(size, index => `  if (n > ${index + 1}) picked = ${named[index + 1]};`)}  return picked;\n}\nconsole.log(typeof pick(process.argv.length));\n`,
      };
    },
  },
  {
    name: "lines that each add an element to one sum and truncate it, in a loop that carries the sum as an integer",
    counted: "lines",
    size: 1000,
    entry: "main.js",
    isExcludedFromCombinedBuild: true,
    write: size => ({
      "main.js":
        `function run(list, turns) {\n  let bits = 0, sum = 0;\n  for (let turn = 0; turn < turns; turn++) {\n` +
        lines(size, index => `    sum += list[${index}]; bits ^= sum & 7;`) +
        `    sum = sum | 0;\n  }\n  return bits + sum;\n}\n${aFloat64Array(size)}console.log(run(list, 3));\n`,
    }),
  },
  {
    name: "calls that each parse a text by one record type of 250 parts, each part in a list",
    counted: "calls",
    size: 100,
    entry: "main.ts",
    isExcludedFromCombinedBuild: true,
    write: size => ({
      "tsconfig.json": withoutLibraryTypes,
      "main.ts":
        declaredConsole +
        lines(250, index => `interface Part${index} { a${index}: number }`) +
        `interface Whole { id: number;\n${lines(250, index => `  part${index}: Part${index}[];`)}}\n` +
        `function use(whole: Whole): number { return whole.id; }\nconst texts: string[] = ['{"id":1}'];\nlet sum = 0;\n` +
        lines(size, () => "sum += use(JSON.parse(texts[0]));") +
        "console.log(sum);\n",
    }),
  },
  {
    // A step of the register allocator that was asked for one value at a time and walked and sorted the blocks each time: 16 s became 207 s at 20,000 sums, on x64 alone,
    // where no register that holds a fraction outlives a call.
    name: "sums of fractions that one loop adds to, all alive past the calls behind it",
    counted: "sums",
    size: 2500,
    entry: "main.js",
    isExcludedFromCombinedBuild: true,
    write: size => ({
      "main.js":
        `const a = [], b = [];\nfor (let i = 0; i <= ${size}; i++) { a.push(i + 0.25); b.push(i * 7); }\n` +
        "function mix(s, v) { return (s * 33 + v) % 1000000007; }\nfunction big(a, b) {\n  let s = 1;\n" +
        lines(size, index => `  let v${index} = 0;`) +
        "  for (let turn = 0; turn < 3; turn++) {\n" +
        lines(size, index => `    v${index} = v${index} + ${index % 3 === 2 ? "b" : "a"}[${index + 1}];`) +
        "    s = mix(s, turn);\n  }\n" +
        lines(size, index => `  s = mix(s, v${index} * 4);`) +
        "  return s;\n}\nconsole.log(big(a, b));\n",
    }),
  },
  {
    // The same without a call in the loop: there each sum may have a register in the loop and wait in the frame elsewhere, and there are no more registers than sixteen.
    name: "sums of fractions that one loop without a call adds to, all alive past the calls behind it",
    counted: "sums",
    size: 2500,
    entry: "main.js",
    isExcludedFromCombinedBuild: true,
    write: size => ({
      "main.js":
        `const a = [];\nfor (let i = 0; i <= ${size}; i++) a.push(i + 0.25);\n` +
        "function mix(s, v) { return (s * 33 + v) % 1000000007; }\nfunction big(a, turns) {\n  let s = 1;\n" +
        lines(size, index => `  let v${index} = 0.5;`) +
        "  for (let turn = 0; turn < turns; turn++) {\n" +
        lines(size, index => `    v${index} = v${index} + a[${index + 1}];`) +
        "  }\n" +
        lines(size, index => `  s = mix(s, v${index} * 4);`) +
        "  return s;\n}\nconsole.log(big(a, 3));\n",
    }),
  },
  // The register allocator carried the widths of values along moves by sweeping over all the moves until nothing changed: a sweep for each move of a long row.
  // From 2,000 branches on a walk back through them reaches TypeScript's limit (TS2563), and then the checker walked back from every reference of the file.
  {
    name: "branches that each give one variable another symbol, which the function returns",
    counted: "branches",
    size: 1500,
    entry: "main.js",
    isInSecondCombinedBuild: true,
    counts: ["MovesVisitedForWidths"],
    write: size => ({
      "main.js":
        lines(size + 1, index => `const s${index} = Symbol("s${index}");`) +
        `function pick(n) {\n  let picked = s0;\n${lines(size, index => `  if (n > ${index + 1}) picked = s${index + 1};`)}  return picked;\n}\n` +
        "console.log(String(pick(process.argv.length).description));\n",
    }),
  },
  {
    // `target[k] = source[k]` is followed name by name. Each name cost flow a lookup with all its nodes, also in a table that is only ever walked.
    name: "names of tables that one helper copies in a for-in, none of them named by any operation",
    counted: "names",
    size: 20000,
    entry: "main.js",
    isExcludedFromCombinedBuild: true,
    write: size => ({
      "main.js":
        "function copy(target, source) { for (const k in source) target[k] = source[k]; return target; }\nlet sum = 0;\n" +
        lines(10, table => `sum += Object.keys(copy({}, { ${upTo(size / 10, index => `t${table}_${index}: ${index}`).join(", ")} })).length;`) +
        "console.log(sum);\n",
    }),
  },
  // What a parameter is used as holds what the next function uses it as. Each name that came from there was looked for among all that had come before it.
  {
    name: "functions that each store a name of their own in what a constructor hands them, and hand it to the next",
    counted: "functions",
    size: 1000,
    entry: "main.js",
    isExcludedFromCombinedBuild: true,
    write: size => ({
      "main.js":
        lines(size, index => `function fill${index}(made) { made.f${index} = ${index}; ${index + 1 < size ? `fill${index + 1}(made); ` : ""}}`) +
        `class Made { constructor() { this.first = 0; ${size ? "fill0(this); " : ""}} }\nconst made = new Made();\n` +
        `console.log(made.first${size ? ` + made.f${size - 1}` : ""});\n`,
    }),
  },
  {
    name: "functions that each store a name of their own in what a constructor hands them, and hand it to the next two",
    counted: "functions",
    size: 1000,
    entry: "main.js",
    isExcludedFromCombinedBuild: true,
    write: size => ({
      "main.js":
        lines(
          size,
          index =>
            `function fill${index}(made) { made.f${index} = ${index}; ${index + 1 < size ? `fill${index + 1}(made); ` : ""}` +
            `${index + 2 < size ? `if (made.first) fill${index + 2}(made); ` : ""}}`,
        ) +
        `class Made { constructor() { this.first = 0; ${size ? "fill0(this); " : ""}} }\nconst made = new Made();\n` +
        `console.log(made.first${size ? ` + made.f${size - 1}` : ""});\n`,
    }),
  },
  {
    name: "classes with a method of one name, and as many functions that each call it on an instance of any of them",
    counted: "classes",
    size: 1000,
    entry: "main.js",
    isExcludedFromCombinedBuild: true,
    write: size => ({
      "main.js":
        `const all = [];\nlet sum = 0;\n` +
        lines(size, index => `class Kind${index} { weigh() { return ${index}; } }\nall.push(new Kind${index}());\nfunction ask${index}(at) { return all[at % all.length].weigh() + ${index}; }\nsum += ask${index}(${index});`) +
        `console.log(sum);\n`,
    }),
  },
  {
    // `handlers["on" + what]` asked for every name of the program that begins with "on", whatever its object held: names times reads, 4.7 GB at 3,000 of each.
    name: "reads under a key that begins with a written text, beside as many names that begin so on another object",
    counted: "reads",
    size: 1500,
    entry: "main.js",
    isExcludedFromCombinedBuild: true,
    write: size => ({
      "main.js":
        `const far = { ${upTo(size + 1, index => `on${index}: ${index}`).join(", ")} };\nlet sum = far.on0;\nconst what = process.argv.length > 5 ? "Open" : "Close";\n` +
        lines(size, index => `const h${index} = { onOpen() { return ${index}; }, onClose() { return ${index + 1}; }, other: 1 };\nsum += h${index}["on" + what]();`) +
        "console.log(sum);\n",
    }),
  },
  // For each join that it came to, MarkResultsUsedAsKeys looked through every block of the function for the edges into that join.
  {
    name: "branches that each give one variable another text, which the function returns",
    counted: "branches",
    size: 1500,
    entry: "main.js",
    isInSecondCombinedBuild: true,
    write: size => ({
      "main.js":
        `function pick(n) {\n  let picked = "t0";\n${lines(size, index => `  if (n > ${index + 1}) picked = "t${index + 1}";`)}  return picked;\n}\n` +
        "console.log(pick(process.argv.length));\n",
    }),
  },
  {
    name: "functions in a chain that each call a method of one name on what they hand on, each given an instance of another class",
    counted: "classes",
    size: 250,
    entry: "main.js",
    isExcludedFromCombinedBuild: true,
    counts: ["FlowReaders"],
    write: size => ({
      "main.js":
        `let sum = 0;\n` +
        lines(size, index => `class Kind${index} { weigh() { return ${index}; } }\nfunction ask${index}(x) { return x.weigh()${index ? ` + ask${index - 1}(x)` : ""}; }\nsum += ask${index}(new Kind${index}());`) +
        `console.log(sum);\n`,
    }),
  },
  // For each package that loads by a name the build does not know, the search for the files that such a load may find went through every file of the program
  // and everything that it imports: 2000 packages of seven files took 16 seconds to bind. No file is found here, so that what is counted is the search.
  {
    name: "packages that each load by a name that they are given",
    counted: "packages",
    size: 1000,
    entry: "main.js",
    isExcludedFromCombinedBuild: true,
    write: size => ({
      "package.json": `{ "name": "program", "version": "1.0.0" }\n`,
      "main.js": `let sum = 0;\n${lines(size, index => `sum += require("package-${index}").load("node:path");`)}console.log(sum);\n`,
      ...Object.fromEntries(
        upTo(size, index => [
          [`node_modules/package-${index}/package.json`, `{ "name": "package-${index}", "version": "1.0.0", "main": "index.js" }\n`],
          [`node_modules/package-${index}/index.js`, `const part = require("./lib/part.js");\nexports.load = name => require(name).sep.length + part.value;\n`],
          [`node_modules/package-${index}/lib/part.js`, `exports.value = ${index % 7};\n`],
        ]).flat(),
      ),
    }),
  },
  {
    // Each function hands on what it was given, so no two calls of the method have the same classes to choose from.
    name: "classes with a method of one name that is called in a chain of functions, each given an instance of one class more",
    counted: "classes",
    size: 400,
    entry: "main.js",
    isExcludedFromCombinedBuild: true,
    write: size => ({
      "main.js":
        `let sum = 0;\n` +
        lines(size, index => `class Kind${index} { weigh() { return ${index}; } }\nfunction ask${index}(x) { return x.weigh()${index ? ` + ask${index - 1}(x)` : ""}; }\nsum += ask${index}(new Kind${index}());`) +
        `console.log(sum);\n`,
    }),
  },
  {
    // What is called is the same in every turn of the loop, so each case has a test that could stand in front of the loop.
    name: "cases of one switch in a loop that each call what nobody knows",
    counted: "cases",
    size: 2000,
    entry: "main.mjs",
    isExcludedFromCombinedBuild: true,
    write: size => ({
      "main.mjs":
        `const seed = process.argv.length;\nfunction g(x) { return (x * 31 + seed) % 1009; }\nconst h = [g, x => x + seed][seed % 2];\n` +
        `function big() {\n  let s = 0;\n  for (let k = 0; k < 3; k++) {\n    switch ((seed * 7 + k) % ${size + 1}) {\n` +
        lines(size, index => `      case ${index}: s += h(${index}); break;`) +
        `    }\n  }\n  return s;\n}\nconsole.log(big());\n`,
    }),
  },
  {
    // Behind each comparison that fails the variable is none of the numbers so far: what flow is told of it grows with each statement.
    name: "statements in a loop that each compare one variable with another number",
    counted: "statements",
    size: 4000,
    entry: "main.mjs",
    isExcludedFromCombinedBuild: true,
    write: size => ({
      "main.mjs":
        `const seed = process.argv.length;\nfunction big() {\n  let s = 0;\n  for (let k = 0; k < 3; k++) {\n` +
        lines(size, index => `    if (k === ${index}) s += seed + ${index};`) +
        `  }\n  return s;\n}\nconsole.log(big());\n`,
    }),
  },
  {
    name: "texts of one list that each become a regular expression at one call",
    counted: "texts",
    size: 4000,
    entry: "main.js",
    isExcludedFromCombinedBuild: true,
    counts: ["RegExpsCompiled"],
    write: size => ({
      "main.js":
        `const texts = [\n` +
        lines(size, index => `  "^(?:alpha|beta)${index}[a-z0-9_]{1,40}(?:-gamma|-delta)+$",`) +
        `  "^x$",\n];\nlet hits = 0;\nfor (let index = 0; index < texts.length; index++) if (new RegExp(texts[(index + process.argv.length) % texts.length]).test("x")) hits++;\nconsole.log(hits);\n`,
    }),
  },
  {
    name: "callers of one function that makes a regular expression of two of its parameters",
    counted: "callers",
    size: 2000,
    entry: "main.js",
    isExcludedFromCombinedBuild: true,
    counts: ["RegExpCandidatesCompiled"],
    write: size => ({
      "main.js":
        "function between(open, close, depth) {\n  if (depth > 0) return between(open, close, depth - 1);\n  return new RegExp(`^${open}[a-z]+${close}$`);\n}\n" +
        `const depth = process.argv.length % 3;\nlet hits = 0;\n` +
        lines(size, index => `function caller${index}() { return between("a${index}", "b${index}", depth).test("a${index}xyzb${index}") ? 1 : 0; }`) +
        lines(size, index => `hits += caller${index}();`) +
        `console.log(hits);\n`,
    }),
  },
  {
    // As a validator does: a family of functions that call one another hand a description round, and each makes a pattern of a member of it. The walk that works a pattern's text out comes to
    // the end of its budget in the family; what it has learnt there for one call it knows for the next.
    name: "validator patterns",
    counted: "functions",
    size: 100,
    entry: "main.js",
    isExcludedFromCombinedBuild: true,
    counts: ["FlowStatementRuns"],
    write: size => ({
      "main.js":
        lines(
          size,
          index =>
            `function make${index}(options, inner) { return { ...options, kind: ${index}, inner, items: inner ? [inner] : [], pattern: options.pattern }; }`,
        ) +
        "function visit(schema, references, value) {\n  const next = schema.id === undefined ? references : [...references, schema];\n  switch (schema.kind) {\n" +
        lines(size, index => `    case ${index}: return visit${index}(schema, next, value);`) +
        "    default: return false;\n  }\n}\n" +
        lines(
          size,
          index =>
            `function visit${index}(schema, references, value) {\n` +
            "  if (schema.inner !== undefined && !visit(schema.inner, references, value)) return false;\n" +
            "  for (const item of schema.items) if (!visit(item, references, value)) return false;\n" +
            `  for (const reference of references) if (reference.kind === ${(index + 1) % size} && !visit${(index + 1) % size}(reference, [], value)) return false;\n` +
            "  return schema.pattern === undefined || new RegExp(schema.pattern).test(value);\n}",
        ) +
        "let root;\n" +
        lines(size, index => `root = make${index}({ pattern: process.argv[${50 + index}] ?? "p${index}+", id: ${index % 3 ? "undefined" : `"i${index}"`} }, root);`) +
        `console.log(root === undefined || visit(root, [], "p"));\n`,
    }),
  },
  {
    // The family above without its patterns, past 200 functions: each read of a member has every description as a receiver, they arrive one at a time, and each holds the member itself.
    name: "validator family",
    counted: "functions",
    size: 110,
    entry: "main.js",
    isExcludedFromCombinedBuild: true,
    write: size => ({
      "main.js":
        lines(
          size,
          index =>
            `function make${index}(options, inner) { return { ...options, kind: ${index}, inner, items: inner ? [inner] : [], pattern: options.pattern }; }`,
        ) +
        "function visit(schema, references, value) {\n  const next = schema.id === undefined ? references : [...references, schema];\n  switch (schema.kind) {\n" +
        lines(size, index => `    case ${index}: return visit${index}(schema, next, value);`) +
        "    default: return false;\n  }\n}\n" +
        lines(
          size,
          index =>
            `function visit${index}(schema, references, value) {\n` +
            "  if (schema.inner !== undefined && !visit(schema.inner, references, value)) return false;\n" +
            "  for (const item of schema.items) if (!visit(item, references, value)) return false;\n" +
            `  for (const reference of references) if (reference.kind === ${(index + 1) % size} && !visit${(index + 1) % size}(reference, [], value)) return false;\n` +
            "  return schema.pattern === undefined || schema.pattern.length > value.length;\n}",
        ) +
        "let root;\n" +
        lines(size, index => `root = make${index}({ pattern: process.argv[${50 + index}] ?? "p${index}+", id: ${index % 3 ? "undefined" : `"i${index}"`} }, root);`) +
        `console.log(root === undefined || visit(root, [], "p"));\n`,
    }),
  },
  {
    name: "closures in one variable that is written under many names",
    counted: "closures",
    size: 1500,
    entry: "main.js",
    isExcludedFromCombinedBuild: true,
    write: size => ({
      "main.js":
        "const all = [];\n" +
        lines(size, index => `all.push(function f${index}() { return ${index}; });`) +
        "const pick = all[process.argv.length] ?? function none() {};\n" +
        lines(512, index => `pick.p${index} = ${index};`) +
        "console.log(typeof pick);\n",
    }),
  },
  {
    name: "functions that each hold the same regular expression",
    counted: "functions",
    size: 1000,
    entry: "main.js",
    isExcludedFromCombinedBuild: true,
    write: size => ({
      "main.js":
        `let hits = 0;\n` +
        lines(size, index => `function test${index}(text) { return /^(?:alpha|beta)[a-z0-9_]{1,40}(?:-gamma|-delta)+$/.test(text + ${index}); }\nif (test${index}("alpha")) hits++;`) +
        `console.log(hits);\n`,
    }),
  },
  {
    name: "alternatives of one regular expression",
    counted: "alternatives",
    size: 4000,
    entry: "main.js",
    isExcludedFromCombinedBuild: true,
    counts: ["RegExpCodeBytesEmitted"],
    write: size => ({
      "main.js": `const long = /^(?:${upTo(size, index => `word${index}[a-z]`).join("|") || "x"})$/;\nconsole.log(long.test("word0a"), long.test("nothing"));\n`,
    }),
  },
  // Whether a value that a loop carries has its type only behind a test is asked of what arrives in its place, and here that is the value of the next place: the answer passes through all of them.
  // All of them wait in the frame, and each move from one slot to the next was held against every live slot, one by one.
  {
    name: "texts that move up one place in every turn of a loop",
    counted: "texts",
    size: 4000,
    entry: "main.js",
    isExcludedFromCombinedBuild: true,
    write: size => ({
      "main.js":
        `function run(list, turns) {\n` +
        lines(size + 1, index => `  let v${index} = "0";`) +
        `  let sum = 0;\n  for (let i = 0; i < turns; i++) {\n    sum += v0.length;\n` +
        lines(size, index => `    v${index} = v${index + 1};`) +
        `    v${size} = list[i];\n  }\n` +
        lines(size + 1, index => `  sum += v${index}.length;`) +
        `  return sum;\n}\nconst list = [];\nfor (let i = 0; i < ${size + 9}; i++) list.push("s" + i);\n` +
        `console.log(run(list, 3), run(list, ${size + 9}));\ntry {\n  run(list, ${2 * size + 22});\n} catch (error) {\n  console.log(error.constructor.name);\n}\n`,
    }),
  },
  {
    // An object that is one of two lives on under the name of the join. Allocation removal took all of them through every block.
    name: "calls of what nobody knows beside variables that each hold one of two object literals",
    counted: "calls",
    size: 2000,
    entry: "main.mjs",
    isExcludedFromCombinedBuild: true,
    write: size => ({
      "main.mjs":
        `const seed = process.argv.length;\nfunction g(x) { return (x * 31 + seed) % 1009; }\nconst h = [g, x => x + seed][seed % 2];\n` +
        `function big() {\n  let s = 0;\n` +
        lines(size / 4, index => `  let v${index} = (seed + ${index}) % 3 ? { a: ${index} } : { a: ${index} + seed };`) +
        lines(size, index => `  s += h(s + v${index % (size / 4)}.a);`) +
        `  return s;\n}\nconsole.log(big());\n`,
    }),
  },
  {
    // Nothing ever needs a cell for such an object. The look ahead of allocation removal still took every 64 of them through every block that they live across.
    name: "objects that are one of two and are only read, alive across calls of what nobody knows",
    counted: "calls",
    size: 2000,
    entry: "main.mjs",
    isExcludedFromCombinedBuild: true,
    counts: ["BlocksVisitedToFindAllocationsThatPay"],
    write: size => ({
      "main.mjs":
        `const seed = process.argv.length;\nfunction g(x) { return (x * 31 + seed) % 1009; }\nconst h = [g, x => x + seed][seed % 2];\n` +
        `const make = [x => ({ a: x }), x => ({ a: x + 1 })][seed % 2];\nfunction big() {\n  let s = 0;\n` +
        lines(size / 4, index => `  let v${index} = make(${index});`) +
        lines(size, index => `  s += h(s + v${index % (size / 4)}.a);`) +
        `  return s;\n}\nconsole.log(big());\n`,
    }),
  },
  {
    // The objects lie in the frame. Each read of one asked every one of them what it holds.
    name: "objects that are one of two and lie in the frame, each read once behind as many branches",
    counted: "objects",
    size: 1000,
    entry: "main.mjs",
    isExcludedFromCombinedBuild: true,
    counts: ["ObjectsInFrameCellsHeldAgainstReads", "ClobberPointsVisitedForCalls"],
    write: size => ({
      "main.mjs":
        `const seed = process.argv.length;\nfunction big() {\n  let s = seed;\n` +
        lines(size, index => `  let v${index} = (seed + ${index}) % 3 ? { a: ${index} } : { a: ${index} + seed };`) +
        lines(size, index => `  if (s & 1) s += ${index}; else s ^= ${index + 1};`) +
        lines(size, index => `  s += v${index}.a;`) +
        `  return s;\n}\nconsole.log(big());\n`,
    }),
  },
  {
    // So many slots are alive together that their places in the frame go by ranges of positions. One slot has as many ranges as there are objects, and it was held against each cell range by range.
    // On arm64 an object takes a third of the slots, and the frame goes by ranges from about 5,000 objects on: between the two sizes, where a count says nothing of growth.
    name: "thousands of objects that are one of two and lie in the frame, each read once behind as many branches",
    counted: "objects",
    size: 3000,
    entry: "main.mjs",
    isExcludedFromCombinedBuild: true,
    counts: process.arch === "x64" ? ["RangesComparedWithStackCells"] : undefined,
    write: size => ({
      "main.mjs":
        `const seed = process.argv.length;\nfunction big() {\n  let s = seed;\n` +
        lines(size, index => `  let v${index} = (seed + ${index}) % 3 ? { a: ${index} } : { a: ${index} + seed };`) +
        lines(size, index => `  if (s & 1) s += ${index}; else s ^= ${index + 1};`) +
        lines(size, index => `  s += v${index}.a;`) +
        `  return s;\n}\nconsole.log(big());\n`,
    }),
  },
  {
    // Every loop tests its counter against one bound, which the calls name too. Each test walked all uses of the bound.
    name: "loops that each add to one sum of fractions up to one bound, with a dozen calls behind each",
    counted: "loops",
    size: 500,
    entry: "main.js",
    isExcludedFromCombinedBuild: true,
    counts: ["UsesReadForStepsBehindTests"],
    write: size => {
      const loop = (index: number) => `  for (let turn = 0; turn < turns; turn++) sum += step * ${index + 1};\n`;
      const calls = "  s = mix(s, turns);\n".repeat(11);
      return {
        "main.js":
          "function mix(s, v) { return (s * 33 + v) % 1000000007; }\nfunction big(turns, step) {\n" +
          "  let s = 1;\n  let sum = 0.5;\n" +
          lines(size, index => `${loop(index)}${calls}  s = mix(s, ${index});`) +
          "  return s + sum;\n}\nconsole.log(big(3, 0.25));\n",
      };
    },
  },
  {
    // Each call tests the variable for the first function. The copies of the joins between the tests led both ways, and every result alive got a parameter at every test.
    name: "calls in a row of a variable that holds one of two functions, each result alive behind the row",
    counted: "calls",
    size: 1000,
    entry: "main.mjs",
    isExcludedFromCombinedBuild: true,
    write: size => ({
      "main.mjs":
        `const seed = process.argv.length;\nconst pick = [x => x + seed, x => x * 3 + 1][seed % 2];\n` +
        `function big() {\n` +
        lines(size, index => `  const v${index} = pick(${index});`) +
        `  let s = 0;\n` +
        lines(size, index => `  s = (s + v${index}) % 1000003;`) +
        `  return s;\n}\nconsole.log(big());\n`,
    }),
  },
  {
    // The loop makes the function warm, so that it gets type tests: a function that runs once gets none. A quarter as many objects as statements stay alive through all of it.
    name: "one function called in a loop that reads objects again and again, with stores to their fields between",
    counted: "statements",
    size: 500,
    entry: "main.mjs",
    isExcludedFromCombinedBuild: true,
    write: size => {
      const objects = Math.max(size >> 2, 1);
      return {
        "main.mjs":
          `class Box { constructor(v) { this.v = v; this.next = null; } }\nclass Other { constructor(v) { this.v = v + 1; this.w = v; } }\n` +
          `const boxes = [];\nfor (let i = 0; i < 64; i++) boxes.push(i % 7 ? new Box(i) : new Other(i));\n` +
          `function big(list, seed) {\n  let s = seed;\n` +
          lines(objects, index => `  const o${index} = list[${index % 64}];`) +
          lines(
            size,
            index =>
              `  s += o${(index * 7) % objects}.v + (o${(index * 7) % objects}.next === null ? 1 : 2);\n` +
              `  o${(index * 3) % objects}.next = s > 1e12 ? o${(index * 5) % objects} : null;`,
          ) +
          `  return s;\n}\nlet total = 0;\nfor (let k = 0; k < 300; k++) total += big(boxes, k);\nconsole.log(total);\n`,
      };
    },
  },
  {
    // The body is warm, so its reads are tested and the tests' proofs are handed on. Each call was asked about every proof, one by one, though a call that may write anything ends
    // every proof about an object that came out of the heap, and all such calls end the same. What still grows with the square: an operation that writes through its operand alone,
    // here the one that makes a list's storage hold doubles, is asked about each proof.
    name: "objects out of the heap whose lists of numbers are read again and again in a warm body, a call between the reads",
    counted: "reads",
    size: 250,
    entry: "main.mjs",
    isExcludedFromCombinedBuild: true,
    counts: ["QuestionsAboutWhoEndsGuards"],
    write: size => ({
      "main.mjs":
        `class Item { constructor(v) { this.v = v; this.list = [v + 0.5, v + 1.5, v + 2.5]; this.link = null; if (v & 1) this.opt = v; } }\n` +
        `const items = []; for (let i = 0; i < 64; i++) items.push(new Item(i)); for (let i = 0; i < 64; i++) items[i].link = items[(i * 5 + 1) % 64];\n` +
        `let depth = 0;\nfunction far(o, s) { if (depth++ > 1e9) return far(o.link, s) + far(o, s + 1); for (let i = 0; i < (s & 1); i++) depth += o.v; return depth & 3; }\n` +
        `function big(seed) {\n  let s = seed;\n` +
        lines(size >> 2, index => `  const x${index} = items[${index % 64}].link;`) +
        lines(
          size,
          index =>
            `  s += x${(index * 7) % (size >> 2)}.list[1] + (x${(index * 7) % (size >> 2)}.opt === undefined ? 1 : x${(index * 7) % (size >> 2)}.opt);\n` +
            `  s += far(items[${index % 64}], s);`,
        ) +
        `  return s;\n}\nlet total = 0; for (let k = 0; k < 300; k++) total += big(k); console.log(total);\n`,
    }),
  },
  // Loops with written bounds are written out turn by turn, and what is left is a row of joins without a cycle. A type that changed went on to the users of its value depth first, so a value behind
  // n joins was typed 2^n times, each time with a range that no value had had before: eight turns around three took four minutes and 17 GB.
  {
    name: "turns of a loop with a written bound around a short loop that holds a try and a finally",
    counted: "turns of the outer loop",
    size: 2,
    entry: "main.js",
    isExcludedFromCombinedBuild: true,
    counts: ["ValuesTypedFromChanges", "TypesInterned"],
    write: size => ({
      "main.js":
        `function run(x, y, z) {\n  let a = x, b = y, c = z, d = 3, e = -1, f = 7;\n  for (let i = 0; i < ${size}; i++) {\n    let j = 0;\n    while (j < 4) {\n      j++;\n` +
        `      try {\n        c += Math.max(e, 5);\n        e = e > c ? c : f;\n      } finally {\n        a ^= Math.max(j, d) & i;\n      }\n    }\n  }\n` +
        `  return a + 3 * b + 5 * c + 7 * d + 11 * e + 13 * f;\n}\n` +
        `console.log(run(65535, 12, 100), run(7, 3, 6), run(-1073741824, -1073741824, 2), run(100, 32768, 32767), run(2147483646, 7, 6));\n`,
    }),
  },
  // Two integers change places and one is mixed with the other, so each value is computed from the two in front of it. Where the last one is compared, the back end asks whether it is a boolean, which
  // goes by its operands. Asked again for every way that leads to a value, 48 statements took four seconds and 64 did not end.
  {
    name: "statements that each mix two integers that have just changed places, in front of a comparison",
    counted: "statements",
    size: 24,
    entry: "main.js",
    isExcludedFromCombinedBuild: true,
    write: size => ({
      "main.js":
        `const seed = process.argv.length;\nfunction mix(x, y) {\n  let a = x | 0, b = y | 0, t = 0;\n` +
        lines(size, () => `  t = a; a = b; b = t; a ^= b & a;`) +
        `  return a === 255;\n}\nlet sum = 0;\nfor (let i = 0; i < 1000; i++) sum += mix(seed + i, i * 7) ? 1 : 0;\nconsole.log(sum);\n`,
    }),
  },
  // Every element of the list may be an instance of any class, and each statement calls another name on one. Who is passed as `this` was asked of every class under every
  // name, by a lookup of its own, though all but one find nothing: 4000 statements made a million lookups and three million nodes.
  {
    name: "statements that each call a method of another name on an instance of any of a quarter as many classes",
    counted: "statements",
    size: 500,
    entry: "main.js",
    isExcludedFromCombinedBuild: true,
    counts: ["FlowStatementRuns"],
    write: size => ({
      "main.js": size
        ? lines(size / 4, index => `class T${index} { constructor() { this.size = ${index}; } m${index}(x) { return (x + this.size) & 7; } }`) +
          `const things = [${upTo(size / 4, index => `new T${index}()`).join(", ")}];\nfunction all(k) {\n  let s = k;\n` +
          lines(size, index => `  s += things[${index % (size / 4)}].m${index % (size / 4)}(s + ${index});`) +
          `  return s;\n}\nconsole.log(all(1));\n`
        : "console.log(0);\n",
    }),
  },
  // Every block that may leave the loop, or go on to its next turn, was met with one near the loop's head by a walk up all the blocks between them.
  {
    name: "breaks in one loop",
    counted: "statements",
    size: 2000,
    entry: "main.js",
    isExcludedFromCombinedBuild: true,
    counts: ["LikelyDominatorWalkSteps"],
    write: size => ({
      "main.js":
        `function big(x, n, o) {\n  let s = 0;\n  for (let i = 0; i < n; i++) {\n` +
        lines(size, index => `    s = (s + x) | 0; if (s === -${(index + 1) * 7919}) break;`) +
        `    x = (x + o.step) | 0;\n  }\n  return s + x;\n}\nconsole.log(big(5, 3, { step: 7 }), big(0, 3, { step: 7 }), big(-9, 2, { step: -1 }));\n`,
    }),
  },
  {
    name: "continues in one loop",
    counted: "statements",
    size: 2000,
    entry: "main.js",
    isExcludedFromCombinedBuild: true,
    counts: ["LikelyDominatorWalkSteps"],
    write: size => ({
      "main.js":
        `function big(x, n, o) {\n  let s = 0;\n  for (let i = 0; i < n; i++) {\n` +
        lines(size, index => `    s = (s + x) | 0; if (s === -${(index + 1) * 7919}) continue;`) +
        `    x = (x + o.step) | 0;\n  }\n  return s + x;\n}\nconsole.log(big(5, 3, { step: 7 }), big(0, 3, { step: 7 }), big(-9, 2, { step: -1 }));\n`,
    }),
  },
  // What a spread copies was read anew for each spread, object by object, and for an object of a list that is written as data the whole list was walked to find it:
  // the cube of the size: 2000 objects and 2000 spreads took 800,000 million instructions in one step of flow's results.
  {
    name: "spreads of an element of one list",
    counted: "objects, and as many spreads",
    size: 250,
    entry: "main.js",
    isExcludedFromCombinedBuild: true,
    write: size => ({
      "main.js": size
        ? `const all = [\n` +
          lines(size, index => `  { id: ${index}, k: ${index} },`) +
          `];\nlet sum = 0;\n` +
          lines(size, index => `function f${index}(i) { return { ...all[i], x: ${index} }; }`) +
          lines(size, index => `sum += f${index}(${(index * 7 + 3) % size}).id;`) +
          `console.log(sum);\n`
        : "console.log(0);\n",
    }),
  },
  // The type of an element is a union of as many object types as there are objects, each with every key, and a spread of it makes an object type of each member:
  // the cube of the size, in tsc too, which takes 14.7 GB for 300. The checker took 26 times the bytes of one such list of properties for each. It takes 10.
  {
    name: "spreads of an element of one list whose objects have a key of their own",
    counted: "objects, and as many spreads",
    size: 60,
    entry: "main.js",
    isExcludedFromCombinedBuild: true,
    write: size => ({
      "main.js": size
        ? `const all = [\n` +
          lines(size, index => `  { id: ${index}, k${index}: ${index} },`) +
          `];\nlet sum = 0;\n` +
          lines(size, index => `function f${index}(i) { return { ...all[i], x${index}: ${index} }; }`) +
          lines(size, index => `sum += f${index}(${(index * 7 + 3) % size}).id;`) +
          `console.log(sum);\n`
        : "console.log(0);\n",
    }),
  },
  // What is copied onto a literal, and onto that in turn, was walked anew from each literal, a new set at every step, and what the sources hold was asked for each
  // pair of literals and each key.
  {
    name: "spreads in a ring of functions",
    counted: "functions",
    size: 1000,
    entry: "main.js",
    isExcludedFromCombinedBuild: true,
    write: size => ({
      "main.js": size
        ? lines(size, index => `function f${index}(o, d) { return d <= 0 ? o : f${(index + 1) % size}({ ${"abcdef"[index % 6]}: d, ...o, ${"abcdef"[(index * 5 + 1) % 6]}: ${index} }, d - 1); }`) +
          `console.log(f0({ a: 1, b: 2 }, ${size + 3}).a);\n`
        : "console.log(0);\n",
    }),
  },
  // A built-in that walks what it is handed learns one level of the objects a round. Whoever then asks the same of a set that is one member larger lets go of all
  // that was asked for before and takes it up again.
  {
    name: "literals in a chain that a built-in walks",
    counted: "literals",
    size: 2000,
    entry: "main.js",
    isExcludedFromCombinedBuild: true,
    write: size => ({
      "main.js": size
        ? `const o0 = { v0: 0 };\n` +
          lines(size, index => `const o${index + 1} = { v${index + 1}: ${index + 1}, next: o${index} };`) +
          `console.log(JSON.stringify(o${size}).length);\n`
        : "console.log(0);\n",
    }),
  },
  {
    name: "instances in a chain that a built-in walks",
    counted: "classes",
    size: 500,
    entry: "main.js",
    isExcludedFromCombinedBuild: true,
    write: size => ({
      "main.js": size
        ? lines(
            size,
            index =>
              `class C${index} {\n  constructor(next) { this.next = next; this.v${index} = ${index}; this.list = [next, { w${index}: ${index} }]; }\n` +
              `  get g${index}() { return this.v${index}; }\n  toJSON() { return { k${index}: this.v${index}, next: this.next }; }\n  m${index}() { return this.list; }\n}`,
          ) +
          `let root = null;\n` +
          lines(size, index => `root = new C${index}(root);`) +
          `console.log(JSON.stringify(root).length);\nconsole.log(root);\n`
        : "console.log(0);\n",
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
