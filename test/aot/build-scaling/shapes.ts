// Programs that are written by a rule and have a size: so many modules, wrappers, calls, layouts, statements. ./build-scaling-cases.ts builds each at
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
  /** What the build is given besides. */
  flags?: string[];
  /** `entry` is a test file: `bun test --aot` builds it and runs it, so what a test run does in front of its build is counted too. */
  isTestRun?: true;
  /** `bun check` reads the program and nothing is built. */
  isCheckedAlone?: true;
  /** Counters that the build prints under --explain=statistics. Their growth is judged however little they count. */
  counts?: string[];
  /**
   * A goal that is not met yet: what the shape was last measured to grow by, in a count that is the same on every machine. The case says so in its name and is
   * expected to fail: it runs every time, and fails once the goal is met.
   */
  growsSoFar?: string;
  /** The same for a growth in instructions: the case is expected to fail where instructions are counted, and is an ordinary case elsewhere. */
  growsSoFarInInstructions?: string;
  /** The same for a growth in instructions that shows under musl alone. */
  growsSoFarInInstructionsUnderMusl?: string;
  /**
   * The shape keeps a value in the frame for each of what is counted, and its two sizes straddle a step in the bytes of arm64's code: a load or store reaches the first 32 KB of a frame by the
   * offset in the instruction (4 bytes), the next 32 KB with one move in front of it (8) and the rest with two (12). There FunctionBytesEmitted is not judged; all else is.
   */
  frameOutgrowsOffsetsOfArm64?: true;
  /** How many times the memory twice the size may take, where the bound of all shapes lies within what one build wavers by. Instructions and counts keep the bound of all shapes. */
  mostGrowthInMemory?: number;
  /** How many times the instructions twice the size may take, where what the program means holds a square of its own or the reading wavers round the bound of all shapes. Memory and counts keep their bounds. */
  mostGrowthInInstructions?: number;
  write(size: number): Record<string, string>;
};

const upTo = <T>(count: number, make: (index: number) => T) => Array.from({ length: count }, (_, index) => make(index));
const lines = (count: number, make: (index: number) => string) => upTo(count, make).join("\n") + "\n";
const withoutLibraryTypes = JSON.stringify({ compilerOptions: { target: "esnext", module: "preserve", moduleResolution: "bundler", strict: true, noEmit: true, allowImportingTsExtensions: true, types: [] } }) + "\n";
const declaredConsole = "declare const console: { log(...values: unknown[]): void };\n";

const filesThatDeclareAGlobalInterface = (size: number, declared: (index: number) => string, first: string, last: string) => ({
  "tsconfig.json": withoutLibraryTypes,
  "first.ts": `declare global {\n${first}\n}\nexport {};\n`,
  ...Object.fromEntries(upTo(size, index => [`m${index}.ts`, `declare global { ${declared(index)} }\nexport const v${index}: number = ${index};\n`])),
  "main.ts": `${declaredConsole}import "./first.ts";\n${lines(size, index => `import { v${index} } from "./m${index}.ts";`)}let sum = 0;\n${lines(size, index => `sum += v${index};`)}${last}`,
});

const rowBehindAFunctionWithALoop = (size: number, row: (index: number) => string, first = "") =>
  `function pick(x, n) { while (n-- > 0) x = x.next; return x; }\nlet sum = 0;\nfunction show() { console.log(sum); }\n${first}${lines(size, row)}show();\n`;

const constructorThatStoresOneOfTwoValues = (size: number) => ({
  "main.js":
    `class Panel {\n  constructor(flag) {\n    let work = 0;\n    for (let i = 0; i < 2; i++) work = (work + i) | 0;\n    this.work = work;\n` +
    lines(size, index => `    this.k${index} = flag ? ${index} : ${index + 1};`) +
    `  }\n}\nconst panel = new Panel(JSON.parse("true"));\nconsole.log(Object.keys(panel).length, panel.work);\n`,
});
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

function recordsMadeInOrdersOfTheirOwn(size: number, names: string) {
  const order = (number: number) => {
    const left = [...names];
    let out = "";
    for (let count = names.length; count; count--) {
      out += left.splice(number % count, 1)[0];
      number = Math.floor(number / count);
    }
    return out;
  };
  return (
    `type Row = { ${[...names].map(name => `${name}?: number`).join("; ")} };\nconst rows: Row[] = [\n` +
    lines(size, index => `  { ${[...order(index)].map(name => `${name}: 1`).join(", ")} },`) +
    "];\nlet total = 0;\n" +
    lines(
      size,
      index =>
        `function count${index}(all: Row[]): number { let n = 0; for (let i = 0; i < all.length; i++) n += Object.keys(all[i]).length; return n + ${index}; }\ntotal += count${index}(rows);`,
    ) +
    "console.log(total);\n"
  );
}

export const shapes: Shape[] = [
  {
    // Whether a key is a number by its syntax was asked of every store into each variable of the key, and of the variables of what is stored, four variables deep, anew for
    // every key. 60 of these groups took 10 s, and 120 did not end, where 8,000 take 0.6 s.
    name: "stores into a typed array by keys made of variables that are each given from the one before",
    counted: "stores",
    size: 2000,
    entry: "main.cjs",
    write: size => ({
      "main.cjs":
        `"use strict";\nconst HEAP = new Int32Array(4096);\nfunction f(given) {\n  var i1 = 0, i2 = 0, i3 = 0, t = 0;\n  i1 = given | 0;\n` +
        lines(size, index => `  i2 = (i1 + ${4 + (index % 5)}) | 0;\n  i3 = (i2 + 4) | 0;\n  i1 = (i3 - ${8 + (index % 5)}) | 0;\n  t = (t + HEAP[(i${1 + (index % 3)} + ${index}) & 4095]) | 0;\n  HEAP[i1 & 4095] = t;`) +
        `  return t | 0;\n}\nconsole.log(f(JSON.parse("3")));\n`,
    }),
  },
  {
    // The same question, where a variable is named many times in one sum: each mention asked it anew.
    name: "a key that is a sum of many mentions of a variable that is such a sum itself",
    counted: "mentions",
    size: 6000,
    entry: "main.cjs",
    write: size => ({
      "main.cjs":
        `"use strict";\nconst rows = JSON.parse("{}");\nfunction f() {\n  let v0 = 1;\n` +
        lines(3, index => `  let v${index + 1} = v${index}${` + v${index}`.repeat(size)};`) +
        `  v0++; v1++; v2++; v3++;\n  rows[v3] = 1;\n  return rows[v3];\n}\nconsole.log(f());\n`,
    }),
  },
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
  // Each file was found in a round of its own, and behind every round each entry point was held against all that had been found: 2,000 of them took 119 G instructions, 3 G with constants.
  {
    name: "CommonJS modules that each require the next by a name with a written default",
    counted: "modules",
    size: 400,
    entry: "main.cjs",
    write: size => ({
      ...Object.fromEntries(
        upTo(size + 1, index => [
          `p${index}.cjs`,
          `exports.name = ${index};\n${index < size ? `exports.next = require(process.env.MADE_UP_${index + 1} || "./p${index + 1}.cjs");\n` : ""}`,
        ]),
      ),
      "main.cjs": `let sum = 0;\nfor (let link = require(process.env.MADE_UP_0 || "./p0.cjs"); link; link = link.next) sum += link.name;\nconsole.log(sum);\n`,
    }),
  },
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
    // Under musl one and the same build reads 2.08 to 2.12 from try to try, on both sides of the bound of all shapes. The memory is a straight line: 1,200 files more add 37 MB, 2,400 more 82, 4,800 more 160.
    // The first files fill room that a build of nothing holds already, in another stage, and that bends the first doubling upward. Of a square each doubling adds four times what the one before it added.
    mostGrowthInMemory: 2.2,
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
  // A name that a test may have laid on Object.prototype is not absent above the classes. Each such name that was read off an object out of many layouts walked every one of those layouts, and said
  // the same of each that does not have the name: names x layouts. On a suite of 4,444 test files 1,072 names more took Link 48.8 G instructions more.
  {
    name: "names that a test stores on an object from somewhere, read off objects of as many layouts that meet",
    counted: "names, and layouts",
    size: 1200,
    entry: "a.test.js",
    isTestRun: true,
    write: size => ({
      "package.json": `{ "name": "p", "type": "module" }\n`,
      "a.test.js":
        `import { expect, test } from "bun:test";\n` +
        `const put = object => {\n${lines(size, index => `  object.n${index} = ${index};`)}};\n` +
        `const made = [\n${lines(size, index => `  { f${index}: ${index} },`)}];\n` +
        `const read = object => {\n  let sum = 0;\n${lines(size, index => `  sum += object.n${index} ?? 1;`)}  return sum;\n};\n` +
        `test("it reads", () => {\n  if (made.length < 0) put(Object.prototype);\n  expect(read(made[made.length >> 1] ?? {})).toBe(${size});\n});\n`,
    }),
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
  // Behind `export *` a mock may answer a name ahead of the file that declares it. Each file asked that of each of its names, walked the rest of the chain anew, and looked through the whole way
  // it had come at each step: files x files x files. Behind that, at the run, the link of each file resolved its name through the rest of the chain. 3,000 files took 67 G instructions, then 10, and take 3.6.
  {
    name: "files that each export everything of the next, the last of them mocked, in a test run",
    counted: "files",
    // The longer the chain the faster it grows: 2.03 at 750 files, 2.08 at 1,500, 2.20 at 3,000, where memory grows 3 times: some 34 instructions for each pair of files are left, beside 460,000 a file.
    size: 750,
    entry: "a.test.js",
    isTestRun: true,
    write: size => ({
      "package.json": `{ "name": "p", "type": "module" }\n`,
      ...Object.fromEntries(upTo(size, index => [`m${index}.js`, `export * from "./m${index + 1}.js";\n`])),
      [`m${size}.js`]: `export const x = 1;\n`,
      "a.test.js":
        `import { expect, mock, test } from "bun:test";\nmock.module("./m${size}.js", () => ({ x: 2 }));\nimport { x } from "./m0.js";\n` +
        `test("it loads", () => { expect(x).toBe(2); });\n`,
    }),
  },
  // The same chain, but the mock is laid first and the chain is loaded behind it, so the link runs while the mock stands in place. Nothing that hangs on the mocks was kept then: each file's name was
  // resolved through the rest of the chain, each step of that asked what is left out behind the stars, and each level of that walked the rest of the chain: 320 files took 18 seconds.
  {
    name: "files that each export everything of the next, loaded behind a mock of the last, in a test run",
    counted: "files",
    size: 256,
    entry: "a.test.js",
    isTestRun: true,
    write: size => ({
      "package.json": `{ "name": "p", "type": "module" }\n`,
      ...Object.fromEntries(upTo(size, index => [`m${index}.js`, `export * from "./m${index + 1}.js";\n`])),
      [`m${size}.js`]: `export const x = 1;\n`,
      "a.test.js":
        `import { expect, mock, test } from "bun:test";\nmock.module("./m${size}.js", () => ({ x: 2 }));\n` +
        `test("it loads", async () => { const { x } = await import("./m0.js"); expect(x).toBe(2); });\n`,
    }),
  },
  {
    name: "functions that each load a file by the first of a list, the lists all under one name",
    counted: "functions",
    size: 2000,
    entry: "main.js",
    write: size => ({
      "package.json": `{ "name": "p", "type": "commonjs" }\n`,
      "loaded.js": `exports.one = 1;\n`,
      "main.js":
        `${lines(size, index => `function f${index}() { const list = ["./loaded.js"]; return require(list[0]).one; }`)}` +
        `let sum = 0;\n${lines(size, index => `sum += f${index}();`)}console.log(sum);\n`,
    }),
  },
  {
    name: "consts at the head of a function whose text holds a backslash, each read once, in a test run with a mock",
    counted: "consts",
    size: 4000,
    entry: "a.test.js",
    isTestRun: true,
    write: size => ({
      "package.json": `{ "name": "p", "type": "module" }\n`,
      "mocked.js": `export const x = 1;\n`,
      "big.js":
        `export function asked() {\n${lines(size, index => `  const c${index} = ${index};`)}  let sum = "\\n".length;\n` +
        `${lines(size, index => `  sum += c${index};`)}  return sum;\n}\n`,
      "a.test.js":
        `import { expect, mock, test } from "bun:test";\nmock.module("./mocked.js", () => ({ x: 2 }));\nimport { asked } from "./big.js";\n` +
        `test("it loads", () => { expect(asked()).toBe(${1 + (size * (size - 1)) / 2}); });\n`,
    }),
  },
  {
    name: "texts with a backslash in one function, in a test run with a mock",
    counted: "texts",
    size: 4000,
    entry: "a.test.js",
    isTestRun: true,
    write: size => ({
      "package.json": `{ "name": "p", "type": "module" }\n`,
      "mocked.js": `export const x = 1;\n`,
      "big.js": `export function asked() {\n  return [\n${lines(size, index => `    "\\n${index}",`)}  ];\n}\n`,
      "a.test.js":
        `import { expect, mock, test } from "bun:test";\nmock.module("./mocked.js", () => ({ x: 2 }));\nimport { asked } from "./big.js";\n` +
        `test("it loads", () => { expect(asked().length).toBe(${size}); });\n`,
    }),
  },
  {
    name: "functions that each stand behind a marked comment with a word that a mock looks for, in a test run with a mock",
    counted: "functions",
    size: 8000,
    entry: "a.test.js",
    isTestRun: true,
    write: size => ({
      "package.json": `{ "name": "p", "type": "module" }\n`,
      "mocked.js": `export const x = 1;\n`,
      "big.js":
        lines(size, index => `/*! \\${index % 8} importOriginal */\nfunction f${index}() {\n  return ${index};\n}`) +
        `export const last = ${size ? `f${size - 1}()` : -1};\n`,
      "a.test.js":
        `import { expect, mock, test } from "bun:test";\nmock.module("./mocked.js", () => ({ x: 2 }));\nimport { last } from "./big.js";\n` +
        `test("it loads", () => { expect(last).toBe(${size - 1}); });\n`,
    }),
  },
  {
    name: "functions that each stand behind a comment with a word that a mock looks for, in a test run with a mock",
    counted: "functions",
    size: 8000,
    entry: "a.test.js",
    isTestRun: true,
    write: size => ({
      "package.json": `{ "name": "p", "type": "module" }\n`,
      "mocked.js": `export const x = 1;\n`,
      "big.js":
        lines(size, index => `// importOriginal ${index}\nfunction f${index}() {\n  return ${index};\n}`) +
        `export const last = ${size ? `f${size - 1}()` : -1};\n`,
      "a.test.js":
        `import { expect, mock, test } from "bun:test";\nmock.module("./mocked.js", () => ({ x: 2 }));\nimport { last } from "./big.js";\n` +
        `test("it loads", () => { expect(last).toBe(${size - 1}); });\n`,
    }),
  },
  {
    name: "consts in a chain over a member of an enum, each read twice by the next, in a test run with a mock",
    counted: "consts",
    size: 20000,
    entry: "a.test.js",
    isTestRun: true,
    write: size => ({
      "package.json": `{ "name": "p", "type": "module" }\n`,
      "mocked.js": `export const x = 1;\n`,
      "big.ts":
        `enum Shade { Pale = 1 }\nexport function asked() {\n  const c0 = Shade.Pale;\n` +
        `${lines(size, index => `  const c${index + 1} = c${index} ? c${index} : 0;`)}  return "\\n".length + c${size};\n}\n`,
      "a.test.js":
        `import { expect, mock, test } from "bun:test";\nmock.module("./mocked.js", () => ({ x: 2 }));\nimport { asked } from "./big.ts";\n` +
        `test("it loads", () => { expect(asked()).toBe(2); });\n`,
    }),
  },
  {
    name: "halls that each open by two files onto the next, the last onto the first again, over one mocked file, in a test run",
    counted: "halls",
    size: 6,
    entry: "a.test.js",
    isTestRun: true,
    write: size => ({
      "package.json": `{ "name": "p", "type": "module" }\n`,
      "cellar.js": `export const wine = 1;\n`,
      "vault.js": `export const gold = 2;\n`,
      "door.js": size ? `export * from "./hall0.js";\n` : `export * from "./cellar.js";\nexport * from "./vault.js";\n`,
      ...Object.fromEntries(
        upTo(size, level => {
          const below =
            level + 1 < size
              ? `export * from "./hall${level + 1}.js";\n`
              : `export * from "./hall0.js";\nexport * from "./cellar.js";\nexport * from "./vault.js";\n`;
          return [
            [`hall${level}.js`, `export * from "./left${level}.js";\nexport * from "./right${level}.js";\n`],
            [`left${level}.js`, below],
            [`right${level}.js`, below],
          ];
        }).flat(),
      ),
      "a.test.js":
        `import { expect, mock, test } from "bun:test";\nmock.module("./vault.js", () => ({ gold: 3 }));\nimport { gold, wine } from "./door.js";\n` +
        `test("it loads", () => { expect(wine + (gold > 0 ? 1 : 0)).toBe(2); });\n`,
    }),
  },
  {
    name: "halls that each open by two files onto the next, the last onto the first again, loaded behind a mock that the test lays",
    counted: "halls",
    size: 10,
    entry: "a.test.js",
    isTestRun: true,
    write: size => ({
      "package.json": `{ "name": "p", "type": "module" }\n`,
      "cellar.js": `export const wine = 1;\n`,
      "vault.js": `export const gold = 2;\n`,
      "hall0.js": size
        ? `export * from "./left0.js";\nexport * from "./right0.js";\n`
        : `export * from "./cellar.js";\nexport * from "./vault.js";\n`,
      ...Object.fromEntries(
        upTo(size, level => {
          const below =
            level + 1 < size
              ? `export * from "./hall${level + 1}.js";\n`
              : `export * from "./hall0.js";\nexport * from "./cellar.js";\nexport * from "./vault.js";\n`;
          return [
            ...(level ? [[`hall${level}.js`, `export * from "./left${level}.js";\nexport * from "./right${level}.js";\n`]] : []),
            [`left${level}.js`, below],
            [`right${level}.js`, below],
          ];
        }).flat(),
      ),
      "guest.js": `import { gold, wine } from "./hall0.js";\nexport const look = () => wine + gold;\n`,
      "a.test.js":
        `import { expect, test, vi } from "bun:test";\ntest("it loads", async () => {\n  vi.doMock("./vault.js", () => ({ gold: 3 }));\n` +
        `  const halls = await import("./hall0.js");\n  expect(Object.keys(halls).length + halls.wine + halls.gold).toBe(6);\n` +
        `  expect((await import("./guest.js")).look()).toBe(4);\n});\n`,
    }),
  },
  // Two files a layer, each exporting everything of both files of the next, and every file mocked. The read of one imported name wrote out the way to its declaration, and at each file that holds
  // a mock all that lies behind it anew: the ways double a layer. 16 layers took 13 G instructions and 1.2 GB, 22 never ended. A file that the way has written out once is asked of the run after that.
  {
    name: "layers of two files that each export everything of both files of the next layer, every file mocked, in a test run",
    counted: "layers",
    size: 16,
    entry: "a.test.js",
    isTestRun: true,
    write: size => ({
      "package.json": `{ "name": "p", "type": "module" }\n`,
      "more.cjs": `exports.other = 1;\n`,
      ...Object.fromEntries(
        upTo(size, layer =>
          ["l", "r"].map(side => [
            `${side}${layer}.mjs`,
            (layer + 1 < size ? `export * from "./l${layer + 1}.mjs";\nexport * from "./r${layer + 1}.mjs";\n` : `export * from "./more.cjs";\n`) +
              `export const own_${side}${layer} = 1;\n`,
          ]),
        ).flat(),
      ),
      "user.mjs": size
        ? `import { none } from "./l0.mjs";\nexport const look = () => String(none);\n`
        : `export const look = () => { throw new Error("none"); };\n`,
      "a.test.js":
        `import { expect, test, vi } from "bun:test";\ntest("it loads", async () => {\n` +
        lines(size, layer => `  vi.doMock("./l${layer}.mjs", () => ({}));\n  vi.doMock("./r${layer}.mjs", () => ({}));`) +
        `  let said;\n  try { said = (await import("./user.mjs")).look(); } catch (error) { said = error.name; }\n  expect(said).toBe("Error");\n});\n`,
    }),
  },
  // One name that only the run can find, read as many times as the barrel that it is read off has stars, and one file behind the stars mocked. Each read asked every star for the name: reads x stars:
  // 4,000 took 43 G instructions, and take 7. The places of the stars by name were kept where the program is linked, and were not handed to the lowering of a read.
  // At these sizes the build holds too little for its memory to be judged: at 1,000 and 2,000 that read 2.00 to 2.06 times, with and without the mend.
  // One name and not many: as many NAMES cost the run names x stars in plain Bun too, where each name is resolved over all stars, and the checker looks through all exports for a name close to each.
  {
    name: "reads of one name that only the run finds, off a barrel of as many stars, one file behind them mocked, in a test run",
    counted: "reads",
    size: 500,
    entry: "a.test.js",
    isTestRun: true,
    write: size => ({
      "package.json": `{ "name": "p", "type": "module" }\n`,
      "more.cjs": `exports[["fou", "nd"].join("")] = 1;\n`,
      "third.cjs": `exports[["oth", "er"].join("")] = 1;\n`,
      "mocked.mjs": `export const told = "real";\n`,
      ...Object.fromEntries(upTo(size, part => [`f${part}.mjs`, `export const n${part} = ${part};\n`])),
      "barrel.mjs": `${lines(size, part => `export * from "./f${part}.mjs";`)}export * from "./mocked.mjs";\nexport * from "./more.cjs";\nexport * from "./third.cjs";\n`,
      "user.mjs": `import { found, told } from "./barrel.mjs";\nexport const sum = () => [${upTo(size, () => "found").join(", ")}].reduce((a, b) => a + b, 0) + " " + told;\n`,
      "a.test.js":
        `import { expect, test, vi } from "bun:test";\ntest("it adds", async () => {\n  vi.doMock("./mocked.mjs", () => ({ told: "mocked" }));\n` +
        `  expect((await import("./user.mjs")).sum()).toBe("${size} mocked");\n});\n`,
    }),
  },
  // At the foot of a chain of barrels a file hands on forty names by a statement, beside a star of a mocked file. Whether a mock may answer a name ahead of the file that declares it asks the way it
  // came about the file that the statement names. An answer that had asked so was kept for no later question, and neither was any above it: barrels x barrels x names. 600 barrels took 26.5 G
  // instructions, and take 3.0: the answer is kept with the files that it found off the way.
  {
    name: "barrels that each export everything of the next, above a file that hands on forty names by a statement beside a star of a mocked file, in a test run",
    counted: "barrels",
    size: 300,
    entry: "a.test.js",
    isTestRun: true,
    write: size => ({
      "package.json": `{ "name": "p", "type": "module" }\n`,
      ...Object.fromEntries(upTo(size, index => [`b${index}.js`, `export * from "./${index + 1 < size ? `b${index + 1}` : "foot"}.js";\n`])),
      "foot.js": `export { ${upTo(40, index => `n${index}`).join(", ")} } from "./leaf.js";\nexport * from "./mocked.js";\n`,
      "leaf.js": lines(40, index => `export const n${index} = ${index};`),
      "mocked.js": `export const held = 1;\n`,
      "a.test.js":
        `import { expect, mock, test } from "bun:test";\nmock.module("./mocked.js", () => ({ held: -1 }));\n` +
        `test("it loads", async () => { const all = await import("./${size ? "b0" : "foot"}.js"); expect([all.n0, all.n39, all.held]).toEqual([0, 39, -1]); });\n`,
    }),
  },
  // Whether a mock may answer a name ahead of the file that declares it is asked by a walk down the stars. An answer below which the walk had come round to a file on its way was kept
  // for no other way to the same file, so the walk went every way through a ring. Three shapes of that: 24 files of the first took 228,000 M instructions, 16 levels of the second 164,000 M,
  // 11 barrels of the third 77,000 M, each for 2,000 M. Within one walk such a file is now walked once, as the language comes to a module once for a name.
  {
    name: "files of a ring that each export everything of three others, the first also of a mocked file, in a test run",
    counted: "files",
    size: 10,
    entry: "a.test.js",
    isTestRun: true,
    write: size => ({
      "package.json": `{ "name": "p", "type": "module" }\n`,
      "leaf.js": upTo(20, index => `export const a${index} = ${index};\n`).join(""),
      ...Object.fromEntries(
        upTo(size, index => [
          `b${index}.js`,
          [1, 3, 5].map(step => `export * from "./b${(index + step) % size}.js";\n`).join("") + (index ? "" : `export * from "./leaf.js";\n`),
        ]),
      ),
      "a.test.js":
        `import { expect, mock, test } from "bun:test";\ntest("it loads", async () => {\n  mock.module("./leaf.js", () => ({ a0: "mocked" }));\n` +
        `  const all = await import("./${size ? "b0" : "leaf"}.js");\n  expect(all.a0).toBe("mocked");\n});\n`,
    }),
  },
  {
    name: "levels of two files that each export everything of both files of the next level, the last level of the first file again, in a test run",
    counted: "levels",
    size: 7,
    entry: "a.test.js",
    isTestRun: true,
    write: size => ({
      "package.json": `{ "name": "p", "type": "module" }\n`,
      "declares.js": upTo(8, index => `export const n${index} = "declared";\n`).join(""),
      "mocked.js": `export const z = 1;\n`,
      ...Object.fromEntries(
        upTo(size + 1, level =>
          ["a", "c"].map(side => [
            `${side}${level}.js`,
            level < size
              ? `export * from "./a${level + 1}.js";\nexport * from "./c${level + 1}.js";\n`
              : `export * from "./a0.js";\nexport * from "./declares.js";\nexport * from "./mocked.js";\n`,
          ]),
        ).flat(),
      ),
      "a.test.js":
        `import { expect, mock, test } from "bun:test";\ntest("it loads", async () => {\n  mock.module("./mocked.js", () => ({ z: 2, n0: "mock" }));\n` +
        `  const all = await import("./a0.js");\n  expect([all.n0, all.z]).toEqual(["declared", 2]);\n});\n`,
    }),
  },
  {
    name: "barrels that each export everything of every other, the first also of a mocked file, in a test run",
    counted: "barrels",
    size: 5,
    entry: "a.test.js",
    isTestRun: true,
    write: size => ({
      "package.json": `{ "name": "p", "type": "module" }\n`,
      "leaf.js": `export const leaf = 2;\n`,
      "ring0.js": upTo(size, other => (other ? `export * from "./ring${other}.js";\n` : "")).join("") + `export * from "./leaf.js";\nexport const shared = 1;\n`,
      ...Object.fromEntries(
        upTo(size, index => [`ring${index}.js`, upTo(size, other => (other === index ? "" : `export * from "./ring${other}.js";\n`)).join("")]).slice(1),
      ),
      "a.test.js":
        `import { expect, mock, test } from "bun:test";\ntest("it loads", async () => {\n  mock.module("./leaf.js", () => ({ leaf: -2 }));\n` +
        `  const all = await import("./ring0.js");\n  expect([all.shared, all.leaf]).toEqual([1, -2]);\n});\n`,
    }),
  },
  // Where files lead back to each other by three ways a level, a walk that keeps no answer goes all the ways: three to the power of the files. Who wrote an entry was sought
  // by such a walk for each entry that is left to the run, and the answer thrown away: 20 files took 164,000 M instructions for 2,000 M.
  {
    name: "files of a ring that each export everything of three others and of a mocked file, in a test run",
    counted: "files",
    size: 10,
    entry: "a.test.js",
    isTestRun: true,
    write: size => ({
      "package.json": `{ "name": "p", "type": "module" }\n`,
      "leaf.js": upTo(20, index => `export const a${index} = ${index};\n`).join(""),
      ...Object.fromEntries(
        upTo(size, index => [
          `b${index}.js`,
          [1, 7, 12].map(step => `export * from "./b${(index + step) % size}.js";\n`).join("") + `export * from "./leaf.js";\n`,
        ]),
      ),
      "a.test.js":
        `import { expect, mock, test } from "bun:test";\ntest("it loads", async () => {\n  mock.module("./leaf.js", () => ({ a0: "mocked" }));\n` +
        `  const all = await import("./${size ? "b0" : "leaf"}.js");\n  expect(all.a0).toBe("mocked");\n});\n`,
    }),
  },
  // Each file of a chain declares a name and exports everything of the next, so the entries grow with the square of the files: the size is the entries. A mock over the
  // barrel takes the original and spreads it. Each read off a namespace sought the statements that export the name among all the names that the module requires: entries x files.
  {
    name: "entries of files that each declare a name and export everything of the next, below a barrel whose mock spreads the original, in a test run",
    counted: "entries",
    size: 20_000,
    entry: "a.test.js",
    isTestRun: true,
    write: size => {
      const files = Math.round(Math.sqrt(2 * size));
      return {
        "package.json": `{ "name": "p", "type": "module" }\n`,
        "gauge.js": `export const held = 1;\n`,
        "porch.js": `export * from "./gauge.js";\n`,
        "shelf.js": `export * from "./gauge.js";\nexport * from "./porch.js";\nexport * from "./step0.js";\n`,
        "attic.js": `export * from "./shelf.js";\n`,
        "reader.js": `import * as all from "./attic.js";\nexport const count = () => Object.keys(all).length;\n`,
        ...Object.fromEntries(
          upTo(files + 1, index => [
            `step${index}.js`,
            `export const name${index} = ${index};\n` + (index < files ? `export * from "./step${index + 1}.js";\n` : ""),
          ]),
        ),
        "a.test.js":
          `import { expect, test, vi } from "bun:test";\ntest("it loads", async () => {\n  await import("./porch.js");\n` +
          `  vi.doMock("./gauge.js", () => ({ held: 10 }));\n  vi.doMock("./shelf.js", async original => ({ ...(await original()), added: 1 }));\n` +
          `  vi.resetModules();\n  expect((await import("./reader.js")).count()).toBe(${files + 2});\n});\n`,
      };
    },
  },
  // A module that has been required answers at once unless something is owed. "Something" was asked of the whole run: one mock that had ended and that no load passed again, or one import that had been
  // refused, in files that the required one never reaches, sent every later require() down through all that it imports: requires x files.
  {
    name: "files that one file imports, which is required five times as often, behind a mock that has ended elsewhere, in a test run",
    counted: "files",
    size: 500,
    entry: "a.test.js",
    isTestRun: true,
    write: size => ({
      "package.json": `{ "name": "p", "type": "module" }\n`,
      ...Object.fromEntries(upTo(size, index => [`leaf${index}.mjs`, `export const v${index} = ${index};\n`])),
      "top.mjs": lines(size, index => `import "./leaf${index}.mjs";`) + `export const ok = 1;\n`,
      "shapes.mjs": `export const round = 1;\n`,
      "user.mjs": `import { round } from "./shapes.mjs";\nexport const look = () => round;\n`,
      "a.test.js":
        `import { expect, test, vi } from "bun:test";\n` +
        `test("it answers", async () => { vi.doMock("./shapes.mjs", () => ({ round: 10 })); await import("./user.mjs"); vi.doUnmock("./shapes.mjs");\n` +
        `  let sum = 0; for (let i = 0; i < ${size * 5}; i++) sum += require("./top.mjs").ok; expect(sum).toBe(${size * 5}); });\n`,
    }),
  },
  {
    name: "files that one file imports, which is required five times as often, behind an import that was refused elsewhere, in a test run",
    counted: "files",
    size: 500,
    entry: "a.test.js",
    isTestRun: true,
    write: size => ({
      "package.json": `{ "name": "p", "type": "module" }\n`,
      ...Object.fromEntries(upTo(size, index => [`leaf${index}.mjs`, `export const v${index} = ${index};\n`])),
      "top.mjs": lines(size, index => `import "./leaf${index}.mjs";`) + `export const ok = 1;\n`,
      "shapes.mjs": `export const round = 1, square = 2;\n`,
      "more.cjs": `exports.round = 5;\n`,
      "wide.mjs": `export * from "./more.cjs";\nexport * from "./shapes.mjs";\n`,
      "last.mjs": `export { round } from "./wide.mjs";\n`,
      "user.mjs": `import * as all from "./last.mjs";\nexport const look = () => all.round;\n`,
      "a.test.js":
        `import { expect, test, vi } from "bun:test";\n` +
        `test("it answers", async () => { vi.doMock("./shapes.mjs", () => ({ round: 10 })); await import("./user.mjs"); vi.doUnmock("./shapes.mjs");\n` +
        `  let refused = "-"; try { await import("./user.mjs"); } catch (error) { refused = error.name; } expect(refused).toBe("SyntaxError");\n` +
        `  let sum = 0; for (let i = 0; i < ${size * 5}; i++) sum += require("./top.mjs").ok; expect(sum).toBe(${size * 5}); });\n`,
    }),
  },
  // A barrel, which is what real suites have. For each name that it has from a star the build walked, and entered, every star in front of the file that declares the name: names x stars.
  {
    name: "a file that exports everything of many files, loaded behind a mock of the last, in a test run",
    counted: "files",
    size: 500,
    entry: "a.test.js",
    isTestRun: true,
    // What is left is the run: the namespace of the barrel resolves each of its names through all of its stars.
    growsSoFarInInstructions: "3.07 times in instructions",
    write: size => ({
      "package.json": `{ "name": "p", "type": "module" }\n`,
      ...Object.fromEntries(upTo(size + 1, index => [`m${index}.js`, `export const x${index} = ${index};\n`])),
      "index.js": lines(size + 1, index => `export * from "./m${index}.js";`),
      "a.test.js":
        `import { expect, mock, test } from "bun:test";\nmock.module("./m${size}.js", () => ({ x${size}: -2 }));\n` +
        `test("it loads", async () => { const all = await import("./index.js"); expect(all.x${size}).toBe(-2); });\n`,
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
  // A test that copies members onto a built-in is asked where their keys come from, and the way leads through what functions return, also into another file. What is asked of each
  // value on that way may follow no call of its own: it took eight times as long with each doubling. The copies never run: the chain calls itself three times at each step.
  {
    name: "a chain of exported functions whose last result is copied onto a built-in, in a test run",
    counted: "functions",
    size: 100,
    entry: "a.test.js",
    isTestRun: true,
    write: size => ({
      "package.json": `{ "name": "p", "type": "module" }\n`,
      "chain.js":
        `export function f0(a) { return a; }\nexport function f1(a) { return a + 1; }\n` +
        lines(
          size,
          index =>
            `export function f${index + 2}(a) { return f${index + 1}(f${index}(a), f${Math.max(index - 5, 0)}(a)); }`,
        ) +
        `if (globalThis.neverSet) Object.assign(Promise.prototype, f${size + 1}(1));\n`,
      "a.test.js": `import { expect, test } from "bun:test";\nimport * as all from "./chain.js";\nif (globalThis.neverSet) Object.assign(Promise.prototype, all.f${size + 1}(1));\ntest("it loads", () => { expect(all.f1(1)).toBe(2); });\n`,
    }),
  },
  // To see what an expression names, the front end steps through a call into what the callee returns. Each step copied the lists of what the walk had passed and looked through them from end to end:
  // depth x depth a walk, and a walk starts at each call: 2,000 functions took 143 G instructions where 25 G do. What is left is the sum of the depths: the call of f7 still walks seven deep.
  // Each literal is a type of its own to the checker, so the parameter of f7 was a union of every literal that arrives in it: 2,000 functions, 2,000,000 members, and whoever reads a union looks at each.
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
  // Which files on disk import what a test run loads is asked level by level, and each level read every file again: a chain of 1,000 took 2.9 G instructions and 500,000 readings.
  {
    name: "files outside a test run that import one another in a row",
    counted: "files",
    size: 500,
    entry: "a.test.js",
    isTestRun: true,
    write: size => ({
      "package.json": `{ "name": "p", "type": "module" }\n`,
      "h.js": `export const h = 1;\n`,
      ...Object.fromEntries(upTo(size, index => [`c${index}.js`, index ? `import { c${index - 1} } from "./c${index - 1}.js";\nexport const c${index} = c${index - 1};\n` : `import { h } from "./h.js";\nexport const c0 = h;\n`])),
      "a.test.js": `import { expect, test } from "bun:test";\nimport { h } from "./h.js";\ntest("it loads", () => { expect(h).toBe(1); });\n`,
    }),
  },
  // Past the limit of captures a function hands up scopes alone, and was still listed whole for each callee that named one more variable: 8,000 callees took 6.6 G instructions.
  {
    name: "functions of one function that one declared behind them all calls",
    counted: "functions, each with a constant of its own",
    size: 2000,
    entry: "main.js",
    // Under glibc it grows 2.03 times. What the C library copies, compares and fills for this shape grows in line with it; where the rest goes under musl is not found.
    growsSoFarInInstructionsUnderMusl: "2.26 times in instructions",
    write: size => ({
      "main.js":
        `function run(n) {\n` +
        lines(size, index => `const c${index} = n + ${index};`) +
        lines(size, index => `function f${index}(x) { return x + c${index}; }`) +
        `function hub(x) { let s = 0;\n` +
        lines(size, index => `s += f${index}(x);`) +
        `return s; }\nreturn hub(n);\n}\nconsole.log(run(process.argv.length));\n`,
    }),
  },
  // Whoever stores on an object of no known layout may store on each lost layout that has the name: stores x layouts, though all said the same. 2,000 of each took 7.1 G instructions. Past 1,001 classes in one list the checker gives up (2590) and the file is gone through twice.
  {
    name: "functions that each store one name on an error, beside as many classes in one list that have it",
    counted: "functions, and classes",
    size: 500,
    entry: "main.js",
    write: size => ({
      "main.js":
        lines(size, index => `class T${index} { constructor() { this.a${index} = ${index}; } }\nfunction make${index}() { const t = new T${index}(); t.code = ${index}; return t; }\nfunction fail${index}(x) { const e = new Error("m"); e.code = x + ${index}; return e; }`) +
        `const all = [${upTo(size, index => `make${index}()`).join(", ")}];\nlet s = all.length;\n` +
        lines(size, index => `s += all[${index}].code + fail${index}(1).code;`) +
        `console.log(s);\n`,
    }),
  },
  // A read of a name that no receiver has as a field asked every class at or below the receiver's whether a statement lays the name above it, and climbed from each through all classes above: classes x classes for a read. 4,000 classes in a chain took 644 G instructions, then 27. What is left is a step for each class below the receiver's at each read.
  {
    name: "classes in a chain, a method of each read off its own object",
    counted: "classes",
    size: 250,
    entry: "main.js",
    growsSoFar: "4.13 times in ClassesClimbedAboveMembersOfFamilies",
    write: size => ({
      "main.js": `let count = 0;\n` + lines(size, index => `class C${index}${index ? ` extends C${index - 1}` : ""} { m${index}() { return ${index}; } }\ncount += new C${index}().m${index}() & 1;`) + `console.log(count);\n`,
    }),
  },
  // A read by name through a family made a field beside the fields of every member that has a class above it, and an edge from what is found beside each: classes x names in nodes, entries and edges. 8,000 of each took 245 G instructions and 18.5 GB, then 98 G and 3 GB. From 1,000 on it still grows 2.4 times and more: each member is tied to each read.
  {
    name: "classes below one base, a value of the family read under a name of each",
    counted: "classes, and names",
    size: 500,
    entry: "main.js",
    write: size => ({
      "main.js":
        `let count = 0;\nclass Base { common() { return 1; } }\nconst all = [];\nfunction pick(i) { return all[i % all.length]; }\n` +
        lines(size, index => `class C${index} extends Base { m${index}() { return ${index}; } }\nall.push(new C${index}());`) +
        lines(size, index => `count += pick(${index}).m${index} ? 1 : 0;`) +
        `console.log(count);\n`,
    }),
  },
  // A call by name through a family is tied for every member: a field beside the fields of each is made and watched, and what is found beside each is watched: classes x names in nodes and observers. 4,000 of each: 82 G instructions, 6,454 MB.
  {
    name: "classes below one base, a method of each called on a value of the family where it is there",
    counted: "classes, and names",
    size: 1000,
    entry: "main.js",
    write: size => ({
      "main.js":
        `class Base { tag() { return 0; } }\n` +
        lines(size, index => `class H${index} extends Base { m${index}() { return ${index}; } }`) +
        `const all = [\n` +
        lines(size, index => `  new H${index}(),`) +
        `];\n` +
        lines(size, index => `function r${index}(x) { return x.m${index} ? x.m${index}() : 0; }`) +
        `let sum = 0;\nfor (const x of all.slice(0, 3)) {\n` +
        lines(size, index => `  sum += r${index}(x);`) +
        `}\nconsole.log(sum);\n`,
    }),
  },
  // Each read asks a guard of every class of the family, and the list of what is asked was searched from its head for each class: classes x classes for each name. 4,000 classes and 64 names: 15.6 G instructions over 5.9.
  // With as many names as classes the guards themselves are left, one a class and a name, in the walk and in the image.
  ...(
    [
      ["sixty-four names", "classes", 2000, {}],
      ["as many names", "classes, and names", 500, { growsSoFar: "3.99 times in GuardsOfClassGuardCounts" }],
    ] as const
  ).map(
    ([names, counted, size, mark]): Shape => ({
      name: `classes below one base with one object out of sight, a value of the family read under ${names} that nobody declares`,
      counted,
      size,
      entry: "main.js",
      ...mark,
      write: size => {
        const numberOfNames = names === "as many names" ? size : 64;
        return {
          "main.js":
            `class Base { constructor() { this.kind = 0; } }\n` +
            lines(size, index => `class C${index} extends Base { m${index}() { return ${index}; } }`) +
            `const list = [${upTo(size, index => `new C${index}()`).join(", ")}];\nglobalThis.kept = list[0];\n` +
            lines(numberOfNames, index => `function f${index}(x) { return x.z${index} ? 1 : 0; }`) +
            `let sum = 0;\nfor (const x of list) {\n` +
            lines(numberOfNames, index => `  sum += f${index}(x);`) +
            `}\nconsole.log("SAID", sum);\n`,
        };
      },
    }),
  ),
  // Whether a class at or above the receivers of a read declares the name was asked of every class of the program that declares it: families x classes. 8,000 of each: 2.4 G instructions over 21.9.
  {
    name: "small families, each read under a name that as many other classes declare",
    counted: "families, and classes that declare the name",
    size: 500,
    entry: "main.js",
    write: size => ({
      "main.js":
        `let count = 0;\n` +
        lines(size, index => `class D${index} { go() { return ${index}; } }\ncount += new D${index}().go() & 1;`) +
        lines(
          size,
          index =>
            `class B${index} { b() { return 1; } }\nclass S${index} extends B${index} { s() { return 2; } }\nconst all${index} = [new B${index}(), new S${index}()];\nfunction pick${index}(i) { return all${index}[i % 2]; }`,
        ) +
        lines(size, index => `count += (pick${index}(0).p${index} ? 1 : 0) + (pick${index}(1).q${index} ? 1 : 0) + (pick${index}(0).go ? 1 : 0);`) +
        `console.log(count);\n`,
    }),
  },
  // Literals of one form share a layout, and each accessor laid waits at its one field: to learn whether the field is asked it went through all that wait there already. 4,000 literals: 0.5 G instructions of 3.4.
  {
    name: "literals with a getter and a setter of one name, each read",
    counted: "literals",
    size: 2000,
    entry: "main.js",
    write: size => ({
      "main.js":
        `function run() {\n  let t = 0;\n` +
        lines(size, index => `  const o${index} = { get g() { return 1; }, set g(v) {} }; t += o${index}.g;`) +
        `  return t;\n}\nconsole.log(run());\n`,
    }),
  },
  // One object of the family kept where nobody sees it opens the whole family (whoever holds an heir reaches the base's prototype): every member wakes in every call: classes x names again. 4,000 of each: 91 G instructions, 5,652 MB.
  {
    name: "classes below one base, a method of each called on a value of the family, and one object of them is let go",
    counted: "classes, and names",
    size: 1000,
    entry: "main.js",
    write: size => ({
      "main.js":
        `class Base { tag() { return 0; } }\n` +
        lines(size, index => `class H${index} extends Base { m${index}() { return ${index}; } }`) +
        `const all = [\n` +
        lines(size, index => `  new H${index}(),`) +
        `];\nglobalThis.kept = all[0];\n` +
        lines(size, index => `function r${index}(x) { return x.m${index} ? x.m${index}() : 0; }`) +
        `let sum = 0;\nfor (const x of all.slice(0, 3)) {\n` +
        lines(size, index => `  sum += r${index}(x);`) +
        `}\nconsole.log(sum);\n`,
    }),
  },
  // What is stored under a key that nobody knows lets every class of the table find the unknown: each was woken in each call: classes x names. 2,000 of each: 34 G instructions, 1,427 MB.
  {
    name: "one table of classes written through keys out of JSON.parse, a method of each called on what is read back",
    counted: "classes, and names",
    size: 1000,
    entry: "main.js",
    write: size => ({
      "main.js":
        `const keys = JSON.parse('["k0","k1","k2","k3","k4","k5","k6","k7"]');\nclass Base { constructor() { this.kind = 0; } }\n` +
        lines(size, index => `class C${index} extends Base { m${index}() { return ${index}; } }`) +
        `const table = {};\n` +
        lines(size, index => `table[keys[${index % 8}]] = new C${index}();`) +
        `let sum = 0;\nfor (const k of keys) {\n  const x = table[k];\n` +
        lines(size, index => `  sum += x.m${index} ? x.m${index}() : 0;`) +
        `}\nconsole.log(sum);\n`,
    }),
  },
  // Each read asked each name used off the value of the class tested for, and counted all classes of the table that are in use: names x reads, classes x reads. 4,000 of each: 1.5 G instructions.
  {
    name: "twice as many classes in one table written through keys out of JSON.parse, a method of each called on what is read back",
    counted: "classes, and names",
    size: 2000,
    entry: "main.js",
    write: size => ({
      "main.js":
        `const keys = JSON.parse('["k0","k1","k2","k3","k4","k5","k6","k7"]');\nclass Base { constructor() { this.kind = 0; } }\n` +
        lines(size, index => `class C${index} extends Base { m${index}() { return ${index}; } }`) +
        `const table = {};\n` +
        lines(size, index => `table[keys[${index % 8}]] = new C${index}();`) +
        `let sum = 0;\nfor (const k of keys) {\n  const x = table[k];\n` +
        lines(size, index => `  sum += x.m${index} ? x.m${index}() : 0;`) +
        `}\nconsole.log(sum);\n`,
    }),
  },
  // Each wrapper is a module of its own. For each module that the top of the file mentions the verifier went through all that it had listed for that function: 16,000 wrappers took 3.6 G instructions.
  {
    name: "CommonJS wrappers as a bundler writes them in one file, each called at the top of the file",
    counted: "wrappers",
    size: 8000,
    entry: "main.js",
    write: size => ({
      "main.js":
        `let used = 0;\nfunction use(value) { if (value !== undefined) used++; }\n` +
        `var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);\n` +
        `var require_first = __commonJS((exports, module) => {\n  module.exports = { value: 0 };\n});\n` +
        lines(
          size,
          index =>
            `var require_m${index} = __commonJS((exports, module) => {\n  var before = ${index ? `require_m${(index - 1) >> 1}` : "require_first"}();\n  module.exports = { value: before.value + ${index} };\n});`,
        ) +
        `use(require_first().value);\n` +
        lines(size, index => `use(require_m${index}().value);`) +
        `console.log(used);\n`,
    }),
  },
  // `module.exports = { .. }`: for each key that another file reads, all stores so far were gone through to drop an earlier one of the same name: 16,000 keys took 2.8 G instructions.
  {
    name: "keys of a literal that a CommonJS file exports, each read in another file",
    counted: "keys",
    size: 3000,
    entry: "main.js",
    write: size => ({
      "main.js": `const lib = require("./lib.js");\nlet s = 0;\n` + lines(size, index => `s += lib.f${index}(1);`) + `console.log(s);\n`,
      "lib.js": lines(size, index => `function f${index}(x) { return x + ${index}; }`) + `module.exports = { ${upTo(size, index => `f${index}`).join(", ")} };\n`,
    }),
  },
  // Whether a call of super() is a statement that always runs was asked by going through all such statements of the file: 8,000 classes behind 160,000 statements took 7.9 G instructions.
  {
    name: "classes whose constructors call super, behind twenty times as many expression statements",
    counted: "classes",
    size: 2000,
    entry: "main.js",
    write: size => ({
      "main.js":
        `class Base { constructor(v) { this.v = v; } }\n` +
        lines(20 * size, () => `0;`) +
        lines(size, index => `class E${index} extends Base { constructor(v) { super(v); } }`) +
        `let s = 0;\n` +
        lines(size, index => `s += new E${index}(${index}).v;`) +
        `console.log(s);\n`,
    }),
  },
  // A hoisted function that is only called is made where it is first called. Its time went from caller to callee one round at a time, each over all calls of the file: 8,000 functions took 5.9 G instructions.
  {
    name: "functions of one function that each call the one declared in front of them",
    counted: "functions",
    size: 2000,
    entry: "main.js",
    write: size => ({
      "main.js":
        `function run(n) {\n` +
        lines(size + 1, index => `function f${index}(x) { return x < 0 ? ${index ? `f${index - 1}(x)` : "0"} : x + n; }`) +
        `return f${size}(n);\n}\nconsole.log(run(process.argv.length));\n`,
    }),
  },
  // To type a list the checker reduces the union of what its elements are. For classes in a row it made the list of the members of every class, each member instantiated anew for every heir,
  // and walked the row for each pair: 4,000 classes took 88 G instructions. The values are only said to be of the classes, so that the engine, which has squares of its own on such a row, sees no object of them.
  {
    name: "classes that each extend the last, and one list of values that comments say are one of each",
    counted: "classes",
    size: 1000,
    entry: "main.js",
    write: size => ({
      "main.js":
        `class C0 { m0() { return 0; } }\n` +
        lines(size, index => `class C${index + 1} extends C${index} { m${index + 1}() { return ${index + 1}; } }`) +
        `const x = JSON.parse("null");\nconst all = [${upTo(size + 1, index => `/** @type {C${index}} */ (x)`).join(", ")}];\n` +
        `let s = 0;\nfor (const c of all) if (c) s += c.m0();\nconsole.log(s);\n`,
    }),
  },
  // To find one name on the static side of a class the checker made the whole list of that side: every static member of the base copied and put in order, for each heir: 2,000 of each took 4 G instructions.
  {
    name: "static methods of one base, each called on an heir of its own",
    counted: "static methods, and heirs",
    size: 500,
    entry: "main.js",
    write: size => ({
      "main.js":
        `class Base {\n` +
        lines(size, index => `  static s${index}(v) { return v + ${index}; }`) +
        `}\n` +
        lines(size, index => `class F${index} extends Base {}`) +
        `let s = 0;\n` +
        lines(size, index => `s += F${index}.s${index}(1);`) +
        `console.log(s);\n`,
    }),
  },
  // A read that finds a static field goes on above it, for the field may not be laid yet. Each such read walked all the bases of its class twice and laid an edge from each of them:
  // 1,000 static fields below a row of 1,000 classes made a million edges in the flow of Link, and a row in which each class has a field and calls super grew by more than the square.
  {
    name: "static fields of the last class of a row, each read once",
    counted: "static fields, and classes in the row",
    size: 500,
    entry: "main.js",
    counts: ["FactEdges"],
    write: size => ({
      "main.js":
        `class C0 {}\n` +
        lines(size, index => `class C${index + 1} extends C${index} {}`) +
        `class Last extends C${size} {\n` +
        lines(size, index => `  static s${index} = ${index};`) +
        `}\nlet s = 0;\n` +
        lines(size, index => `s += Last.s${index};`) +
        `console.log(s);\n`,
    }),
  },
  // For each variable that holds a built-in, every expression of the file was gone through for those that name it: 4,000 such constants took 7.7 G instructions.
  {
    name: "constants that each hold what stands above a built-in and are compared",
    counted: "constants",
    size: 1000,
    entry: "main.js",
    write: size => ({
      "main.js":
        `let sum = 0;\n` +
        lines(size, index => `const p${index} = Object.getPrototypeOf(Map.prototype); if (p${index} === Object.prototype) sum += ${index};`) +
        `console.log(sum);\n`,
    }),
  },
  // The first line is there at every size: it brings all of `process`, which is a step and no growth.
  {
    name: "variables that are each stored to twice with a built-in and asked for a name of their own",
    counted: "variables",
    size: 1000,
    entry: "main.js",
    write: size => ({
      "main.js":
        `let sum = 0;\nvar first; first = process; first = process; if (first.madeUp === undefined) sum++;\n` +
        lines(size, index => `var a${index}; a${index} = process; a${index} = process; if (a${index}.madeUp${index} === undefined) sum += ${index};`) +
        `console.log(sum);\n`,
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
    name: "literals of different layouts in one list that is handed to a function",
    counted: "layouts",
    size: 500,
    entry: "main.js",
    write: size => ({
      "main.js": `function count(list) { return list.length; }\nconsole.log(count([\n${lines(size, index => `  { n${index}: ${index}, shared: ${index} },`)}]));\n`,
    }),
  },
  {
    name: "records of one shape in one list that is handed to a function",
    counted: "records",
    size: 4000,
    entry: "main.js",
    write: size => ({
      "main.js": `function count(list) { return list.length; }\nconsole.log(count([\n${lines(size, index => `  { id: ${index}, amount: ${index} },`)}]));\n`,
    }),
  },
  {
    name: "written types that require the same names and have one of their own that may be absent",
    counted: "types, each with a literal and a function",
    size: 1000,
    entry: "main.ts",
    write: size => ({
      "main.ts":
        "let total = 0;\n" +
        lines(
          size,
          index =>
            `interface Item${index} { id: number; name: string; own${index}?: number }\n` +
            `function weigh${index}(item: Item${index}): number { return item.id + item.name.length + (item.own${index} ?? 0); }\n` +
            `total += weigh${index}({ id: ${index}, name: "n", own${index}: 1 });`,
        ) +
        "console.log(total);\n",
    }),
  },
  {
    name: "written types of the same names that a tag tells apart, each with a literal of constants",
    counted: "types, each with a literal and a function",
    size: 1000,
    entry: "main.ts",
    write: size => ({
      "main.ts":
        "let total = 0;\n" +
        lines(
          size,
          index =>
            `interface Item${index} { kind: "k${index}"; id: number; name: string }\n` +
            `function weigh${index}(item: Item${index}): number { return item.id + item.name.length + item.kind.length; }\n` +
            `total += weigh${index}({ kind: "k${index}", id: ${index}, name: "n" });`,
        ) +
        "console.log(total);\n",
    }),
  },
  {
    name: "written types of the same names that a tag tells apart, each with a literal made at run time",
    counted: "types, each with a literal and a function",
    size: 1000,
    entry: "main.ts",
    write: size => ({
      "main.ts":
        "let total = 0;\n" +
        lines(
          size,
          index =>
            `interface Item${index} { kind: "k${index}"; id: number; name: string }\n` +
            `function weigh${index}(item: Item${index}): number { return (item.id + item.name.length + item.kind.length) % 1000; }\n` +
            `total += weigh${index}({ kind: "k${index}", id: total, name: String(total) });`,
        ) +
        "console.log(total);\n",
    }),
  },
  {
    name: "functions that each spread a parameter of one written type and add a name",
    counted: "functions",
    size: 1200,
    entry: "main.ts",
    write: size => ({
      "main.ts":
        "type Start = { first: number; second: number };\nlet sum = 0;\n" +
        lines(size, index => `function widen${index}(given: Start) { return { ...given, more${index}: ${index} }; }`) +
        "const start: Start = { first: 1, second: 2 };\n" +
        lines(size, index => `sum += widen${index}(start).more${index} + widen${index}(start).first;`) +
        "console.log(sum);\n",
    }),
  },
  {
    name: "functions that each spread a parameter of one written type and add a name, fed out of one variable that holds what they make",
    counted: "functions",
    size: 1200,
    entry: "main.ts",
    write: size => ({
      "main.ts":
        "type Start = { first: number; second: number };\nlet sum = 0;\n" +
        lines(size, index => `function widen${index}(given: Start) { return { ...given, more${index}: ${index} }; }`) +
        "let held: Start = { first: 1, second: 2 };\nfunction current(): Start { return held; }\nfunction keep(made: Start) { held = made; sum += made.first; }\n" +
        lines(size, index => `keep(widen${index}(current()));`) +
        "console.log(sum, Object.keys(held).length);\n",
    }),
  },
  {
    name: "functions without types that each spread a parameter and add a name",
    counted: "functions",
    size: 1200,
    entry: "main.js",
    write: size => ({
      "main.js":
        "let sum = 0;\n" +
        lines(size, index => `function widen${index}(given) { return { ...given, more${index}: ${index} }; }`) +
        "const start = { first: 1, second: 2 };\n" +
        lines(size, index => `sum += widen${index}(start).more${index} + widen${index}(start).first;`) +
        "console.log(sum);\n",
    }),
  },
  {
    name: "literals in one function without types that each spread its parameter and add a name",
    counted: "literals",
    size: 1200,
    entry: "main.js",
    write: size => ({
      "main.js":
        "let sum = 0;\nfunction widen(given) {\n  let held = given;\n" +
        lines(size, index => `  held = { ...given, more: ${index} }; sum += held.more + held.first;`) +
        "  return held;\n}\nwiden({ first: 1, second: 2 });\nconsole.log(sum);\n",
    }),
  },
  {
    name: "names of the source written over behind the spread of a parameter, and one added at the end",
    counted: "names",
    size: 3000,
    entry: "main.js",
    write: size => ({
      "main.js":
        `function step(state, i) {\n  return {\n    ...state,\n${lines(size, index => `    name${index}: i,`)}    added: i,\n  };\n}\n` +
        `const made = step({\n${lines(size, index => `  name${index}: ${index},`)}}, 7);\nconsole.log(made.name0 + made.added);\n`,
    }),
  },
  {
    name: "names behind a spread that are each written twice",
    counted: "names",
    size: 3000,
    entry: "main.js",
    write: size => ({
      "main.js":
        `function step(state, i) {\n  return {\n    ...state,\n${lines(size, index => `    name${index}: i,`)}${lines(size, index => `    name${index}: i + ${index % 7},`)}    added: i,\n  };\n}\n` +
        `const made = step({ first: 1 }, 7);\nconsole.log(made.name0 + made.name5 + made.added, Object.keys(made).length);\n`,
    }),
  },
  {
    name: "one name written again and again behind a spread",
    counted: "times",
    size: 3000,
    entry: "main.js",
    write: size => ({
      "main.js":
        `function step(state, i) {\n  return {\n    ...state,\n${lines(size, index => `    again: i + ${index % 7},`)}    added: i,\n  };\n}\n` +
        `const made = step({ first: 1 }, 7);\nconsole.log(made.again, made.added, Object.keys(made).join());\n`,
    }),
  },
  {
    name: "one name written again and again in brackets behind a spread",
    counted: "times",
    size: 3000,
    entry: "main.js",
    write: size => ({
      "main.js":
        `const key = "again";\nfunction step(state, i) {\n  return {\n    ...state,\n${lines(size, index => `    [key]: i + ${index % 7},`)}    added: i,\n  };\n}\n` +
        `const made = step({ first: 1 }, 7);\nconsole.log(made.again, made.added, Object.keys(made).join());\n`,
    }),
  },
  {
    name: "elements of one list that is assigned to, in a check",
    counted: "elements",
    size: 4000,
    entry: "main.ts",
    isCheckedAlone: true,
    write: size => ({
      "tsconfig.json": `{ "compilerOptions": { "strict": true, "noEmit": true, "types": [], "lib": ["es2022"] } }\n`,
      "main.ts": `export function take(list: number[]) {\n  let last = 0;\n  [\n${lines(size, () => "    last,")}  ] = list;\n  return last;\n}\n`,
    }),
  },
  {
    name: "literals copied onto one prototype",
    counted: "literals",
    size: 16000,
    entry: "main.js",
    write: size => ({
      "main.js": `function Target() {}\n${lines(size, index => `Object.assign(Target.prototype, { m${index}: ${index} });`)}console.log(typeof Target);\n`,
    }),
  },
  {
    name: "getters defined on the exports as TypeScript emits them",
    counted: "getters",
    size: 8000,
    entry: "main.js",
    write: size => ({
      "main.js": `"use strict";\nObject.defineProperty(exports, "__esModule", { value: true });\n${lines(size, index => `exports.x${index} = void 0;`)}let one = 1;\n${lines(size, index => `Object.defineProperty(exports, "x${index}", { enumerable: true, get: function () { return one + ${index}; } });`)}console.log(Object.keys(exports).length);\n`,
    }),
  },
  {
    name: "members of one literal with a name that is a number near its front, every eighth read by a getter",
    counted: "members",
    size: 2000,
    entry: "main.js",
    write: size => ({
      "main.js": `const table = {\n  first: 0,\n  "1.5": 1,\n${lines(size, index => `  x${index}: ${index},`)}};\nconst views = {};\n${lines(Math.floor(size / 8), index => `Object.defineProperty(views, "x${index * 8}", { enumerable: true, get: function () { return table.x${index * 8}; } });`)}console.log(Object.keys(views).length);\n`,
    }),
  },
  // A layout has 4,095 fields at most. The two sizes lie on either side of it.
  {
    name: "members of one literal, every eighth read by a getter",
    counted: "members",
    size: 3000,
    entry: "main.js",
    write: size => ({
      "main.js": `const table = {\n  first: 0,\n${lines(size, index => `  x${index}: ${index},`)}};\nconst views = {};\n${lines(Math.floor(size / 8), index => `Object.defineProperty(views, "x${index * 8}", { enumerable: true, get: function () { return table.x${index * 8}; } });`)}console.log(Object.keys(views).length);\n`,
    }),
  },
  {
    name: "members of one literal that calls name under constant keys",
    counted: "members",
    size: 16000,
    entry: "main.js",
    write: size => ({
      "main.js": `function handle(id) {\n  return id;\n}\nconst routes = {\n  "/first": handle,\n${lines(size, index => `  "/r${index}": handle,`)}};\nroutes["/first"](0);\n${lines(size, index => `routes["/r${index}"](${index});`)}console.log(typeof routes);\n`,
    }),
  },
  {
    name: "classes with a static method under one name",
    counted: "classes",
    size: 16000,
    entry: "main.js",
    write: size => ({
      "main.js": `class First {\n  static encode() {\n    return -1;\n  }\n}\n${lines(size, index => `class Message${index} {\n  static encode() {\n    return ${index};\n  }\n}`)}console.log(typeof First);\n`,
    }),
  },
  {
    name: "modules that a bundler wrapped, each held by a variable of another",
    counted: "modules",
    size: 8000,
    entry: "main.js",
    write: size => ({
      "main.js": `var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);\nvar require_first = __commonJS((exports, module) => {\n  module.exports = { value: 0 };\n});\n${lines(size, index => `var require_m${index} = __commonJS((exports, module) => {\n  var before = ${index === 0 ? "require_first" : `require_m${(index - 1) >> 1}`}();\n  module.exports = { value: before.value + ${index} };\n});`)}console.log(require_first().value);\n`,
    }),
  },
  {
    name: "methods of one class under one name",
    counted: "methods",
    size: 16000,
    entry: "main.js",
    write: size => ({
      "main.js": `class Holder {\n  held() {\n    return -1;\n  }\n${lines(size, index => `  held() {\n    return ${index};\n  }`)}}\nconsole.log(typeof Holder);\n`,
    }),
  },
  {
    name: "methods of one class under one name that one call names",
    counted: "methods",
    size: 16000,
    entry: "main.js",
    write: size => ({
      "main.js": `class Holder {\n  held() {\n    return -1;\n  }\n${lines(size, index => `  held() {\n    return ${index};\n  }`)}}\nconsole.log(new Holder().held());\n`,
    }),
  },
  {
    name: "getters of one literal under one constant key",
    counted: "getters",
    size: 16000,
    entry: "main.js",
    write: size => ({
      "main.js": `const key = "held";\nconst holder = {\n  get [key]() {\n    return -1;\n  },\n${lines(size, index => `  get [key]() {\n    return ${index};\n  },`)}};\nconsole.log(holder.held);\n`,
    }),
  },
  {
    name: "type parameters of one function, in a check",
    counted: "type parameters",
    size: 8000,
    entry: "main.ts",
    isCheckedAlone: true,
    write: size => ({
      "tsconfig.json": `{ "compilerOptions": { "strict": true, "noEmit": true, "types": [], "lib": ["es2022"] } }\n`,
      "main.ts": `export function take<\n  First,\n${lines(size, index => `  T${index},`)}>() {}\n`,
    }),
  },
  {
    name: "members of one intersection, in a check",
    counted: "members",
    size: 8000,
    entry: "main.ts",
    isCheckedAlone: true,
    write: size => ({
      "tsconfig.json": `{ "compilerOptions": { "strict": true, "noEmit": true, "types": [], "lib": ["es2022"] } }\n`,
      "main.ts": `export type All = { first: number }\n${lines(size, index => `  & { m${index}: number }`)};\n`,
    }),
  },
  {
    name: "fields of one class under one constant key, in a check",
    counted: "fields",
    size: 16000,
    entry: "main.js",
    isCheckedAlone: true,
    write: size => ({
      "tsconfig.json": `{ "compilerOptions": { "allowJs": true, "noEmit": true, "types": [], "lib": ["es2022"] } }\n`,
      "main.js": `const key = "held";\nexport class Holder {\n${lines(size, index => `  [key] = ${index};`)}}\n`,
    }),
  },
  {
    name: "overloads of one method under a constant key, in a check",
    counted: "overloads",
    size: 1000,
    entry: "main.ts",
    isCheckedAlone: true,
    write: size => ({
      "tsconfig.json": `{ "compilerOptions": { "strict": true, "noEmit": true, "types": [], "lib": ["es2022"] } }\n`,
      "main.ts": `const key = "take";\nexport class Holder {\n${lines(size, index => `  [key](value: ${index}): void;`)}  [key](value: number) {}\n}\n`,
    }),
  },
  {
    name: "private fields of one class, in a check",
    counted: "fields",
    size: 8000,
    entry: "main.ts",
    isCheckedAlone: true,
    write: size => ({
      "tsconfig.json": `{ "compilerOptions": { "strict": true, "noEmit": true, "types": [], "lib": ["es2022"] } }\n`,
      "main.ts": `export class Holder {\n${lines(size, index => `  #field${index} = ${index};`)}}\n`,
    }),
  },
  {
    name: "stores under a constant key into one object, in a check",
    counted: "stores",
    size: 2000,
    entry: "main.ts",
    isCheckedAlone: true,
    write: size => ({
      "tsconfig.json": `{ "compilerOptions": { "strict": true, "noEmit": true, "types": [], "lib": ["es2022"] } }\n`,
      "main.ts":
        `const key = "first";\nexport function fill(table: { first: number }) {\n${lines(size, index => `  table[key] = ${index};`)}  return table;\n}\n`,
    }),
  },
  {
    name: "names in brackets under constants of their own behind a spread, in a check",
    counted: "names",
    size: 6000,
    entry: "main.ts",
    isCheckedAlone: true,
    write: size => ({
      "tsconfig.json": `{ "compilerOptions": { "strict": true, "noEmit": true, "types": [], "lib": ["es2022"] } }\n`,
      "main.ts":
        lines(size, index => `const key${index} = "name${index}";`) +
        `export function step(state: { first: number }, i: number) {\n  return {\n    ...state,\n${lines(size, index => `    [key${index}]: i + ${index % 7},`)}    added: i,\n  };\n}\n`,
    }),
  },
  {
    name: "names that each follow a spread of their own",
    counted: "names",
    size: 500,
    entry: "main.js",
    growsSoFarInInstructions: "3.47 times in instructions",
    write: size => ({
      "main.js":
        `const base = { first: 1 };\nfunction step(i) {\n  return {\n${lines(size, index => `    ...base,\n    name${index}: i,`)}    added: i,\n  };\n}\n` +
        `const made = step(7);\nconsole.log(made.first, made.added, Object.keys(made).length);\n`,
    }),
  },
  {
    name: "attributes that each stand in front of a spread of their own, in a check",
    counted: "attributes",
    size: 500,
    entry: "main.tsx",
    growsSoFarInInstructions: "3.84 times in instructions",
    isCheckedAlone: true,
    write: size => ({
      "tsconfig.json": `{ "compilerOptions": { "jsx": "preserve", "strict": true, "noEmit": true, "types": [], "lib": ["es2022"] } }\n`,
      "main.tsx":
        "declare global { namespace JSX { interface Element {} interface IntrinsicElements { box: { [name: string]: number } } } }\n" +
        `declare const given: { first: number };\nexport const made = <box\n${lines(size, index => `  name${index}={${index}} {...given}`)}/>;\n`,
    }),
  },
  {
    name: "attributes of one element, in a check",
    counted: "attributes",
    size: 6000,
    entry: "main.tsx",
    isCheckedAlone: true,
    write: size => ({
      "tsconfig.json": `{ "compilerOptions": { "jsx": "preserve", "strict": true, "noEmit": true, "types": [], "lib": ["es2022"] } }\n`,
      "main.tsx":
        "declare global { namespace JSX { interface Element {} interface IntrinsicElements { box: { [name: string]: number } } } }\n" +
        `declare const given: { first: number };\nexport const made = <box {...given}\n${lines(size, index => `  name${index}={${index}}`)}/>;\n`,
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
  // Each loop compares its position with the length of the list and stores an object there, which is made between the comparison and the test of the position.
  // Whoever walks the function once for each comparison, or makes its graph anew behind each test that it adds, works by the loop times the function.
  {
    name: "loops that fill one list with objects",
    counted: "loops",
    size: 200,
    entry: "main.js",
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
    write: size => ({
      "main.js":
        "function large(a) {\n  let s = 0;\n" +
        lines(size, index => `  for (let k = 0; k < a.length; k++) s += a[k] + ${index};`) +
        "  return s;\n}\nconsole.log(large([1, 2, 3]));\n",
    }),
  },
  // Each statement reads a list that a variable of the file holds, and the last statement of the loop stores the variable.
  // Whoever walks the loop for each read, to learn whether its text stores the variable, works by the read times the loop: 32,000 reads took 123,000 M instructions where 8,000 took 9,400.
  {
    name: "reads of a list that a variable of the file holds, in a loop that stores the variable",
    counted: "reads",
    size: 4000,
    entry: "main.js",
    write: size => ({
      "main.js":
        'let held = JSON.parse("[1, 2, 3, 4, 5, 6, 7, 8]");\nconst first = held;\nfunction large(n) {\n  let s = 0;\n  for (let i = 0; i < n; i++) {\n' +
        lines(size, index => `    s += held[${index & 7}];`) +
        "    held = first;\n  }\n  return s;\n}\nconsole.log(large(2));\n",
    }),
  },
  // Each statement stores what it reckons of an element into another list, and nothing is known of either list. In the copy of the loop where one holder is a list the others are asked for one too.
  // Whoever reads the text of the loop anew for each such access, or goes through all accesses to find a holder that is a list, works by the access times the loop: 2,000 statements took 226,000 M instructions where 500 took 16,600.
  {
    name: "stores of what is reckoned of an element into another list of which nothing is known, in one loop",
    counted: "stores",
    size: 1000,
    entry: "main.js",
    write: size => ({
      "main.js":
        'const prices = JSON.parse("[1.5, 2.5, 3.5, 4.5]"), scaled = JSON.parse("[0, 0, 0, 0]");\nfunction large(count, seed) {\n  const shift = seed & 7;\n  for (let i = 0; i < count; i++) {\n' +
        lines(size, () => "    scaled[i] = prices[i] * 0.5 + shift;") +
        "  }\n  return scaled.join();\n}\nconsole.log(large(4, 3));\n",
    }),
  },
  // Each statement stores the answer of one helper under an index, and the helper's sum has as many terms as there are statements.
  // Whoever reads the text of the helper at each store, to learn what its answer says, works by the stores times the terms: 4,000 of each took 6,600 M instructions where 2,000 took 3,000: 3.04 times.
  // Without that the shape takes 2.13 times: a little over the bound of all shapes, from something older that nobody has looked for yet.
  {
    name: "stores under an index of the answer of a helper whose sum has as many terms",
    counted: "stores and terms",
    size: 2000,
    entry: "main.js",
    mostGrowthInInstructions: 2.4,
    write: size => ({
      "main.js":
        'const prices = JSON.parse("[1.5, 2.5, 3.5, 4.5]"), other = JSON.parse("[2, 4, 8, 16]"), scaled = JSON.parse("[0, 0, 0, 0]");\nconst blend = (c, a) => ' +
        upTo(size, index => `c * ${index & 7}`).join(" + ") +
        " + a * 0.5;\nfunction large(count) {\n  for (let i = 0; i < count; i++) {\n" +
        lines(size, () => "    scaled[i] = blend(prices[i], other[i]);") +
        "  }\n  return scaled.join();\n}\nconsole.log(large(4));\n",
    }),
  },
  // Each sum adds the sum before it to itself, and the last is stored under an index. Whether the text of a stored sum can only add numbers is asked of both its sides.
  // Whoever goes down both sides of every sum anew doubles the work with each sum: 26 sums took 20 seconds, 32 would take 20 minutes.
  {
    name: "sums that each add the sum before to itself, the last of them stored under an index in a loop",
    counted: "sums",
    size: 1000,
    entry: "main.js",
    write: size => ({
      "main.js":
        'const read = JSON.parse("[1.5, 2.5, 3.5, 4.5]"), list = JSON.parse("[0, 0, 0, 0]");\nfunction large(count) {\n  for (let i = 0; i < count; i++) {\n    const v0 = read[i] * 1e-300;\n' +
        lines(size, index => `    const v${index + 1} = v${index} + v${index};`) +
        `    list[i] = v${size};\n  }\n  return list.join();\n}\nconsole.log(large(4));\n`,
    }),
  },
  // Whether an element is added to a number is asked of the sum that it is added to, and of the sum below that one. Whoever goes down the whole chain for each element goes n x n steps.
  {
    name: "elements that one loop adds to one sum beside a product of an element",
    counted: "elements",
    size: 4000,
    entry: "main.js",
    write: size => ({
      "main.js":
        'let held = JSON.parse("[1, 2, 3, 4, 5, 6, 7, 8]");\nconst first = held;\nfunction large(n) {\n  let s = 0, p = 1;\n  for (let i = 0; i < n; i++) {\n    p = (p * held[i & 7]) & 1023;\n' +
        lines(size, index => `    s += held[${index & 7}];`) +
        "    held = first;\n  }\n  return s + p;\n}\nconsole.log(large(2));\n",
    }),
  },
  // Each value is compared with a written primitive in front of a way out, and every one of them is used again at the end of the function.
  // Whoever looks, at each use, through all that has been excluded so far works by the use times the comparisons.
  {
    name: "values compared with a written primitive in front of a way out, all used again at the end",
    counted: "values",
    size: 2000,
    entry: "main.js",
    write: size => ({
      "main.js":
        "const holder = { list: [{ make(n) {\n  return n % 7 === 6 ? true : { n };\n} }] };\nfunction large(from, held) {\n  const by = held.list[0], kept = [];\n" +
        lines(size, index => `  const v${index} = by.make(from + ${index % 5});\n  if (v${index} === true) return ${index};`) +
        lines(size, index => `  kept.push(v${index});`) +
        "  return kept.length;\n}\nconsole.log(large(0, holder));\n",
    }),
  },
  // Each value is compared with a written primitive, and where the comparison holds the text breaks out to one label behind them all.
  // Whoever keeps a record an edge and goes through all of them at every block, or climbs each entry's chain to what all entries share, works by the comparisons squared.
  {
    name: "values compared with a written primitive, each with a way out to one label",
    counted: "values",
    size: 2000,
    entry: "main.js",
    write: size => ({
      "main.js":
        "const holder = { list: [{ make(n) {\n  return n % 7 === 6 ? true : { n };\n} }] };\nfunction large(from, held) {\n  const by = held.list[0], kept = [];\n  let hit = -1;\n  out: {\n" +
        lines(size, index => `    const v${index} = by.make(from + ${index % 5});\n    if (v${index} === true) { hit = ${index}; break out; }`) +
        "    kept.push(v0);\n  }\n  return hit + kept.length;\n}\nconsole.log(large(0, holder));\n",
    }),
  },
  // As many handlers stand behind the comparisons as there are comparisons.
  // Whoever takes off all that is excluded at each handler and lays it again at the next block works by the comparisons times the handlers.
  {
    name: "values compared with a written primitive in front of as many handlers",
    counted: "values",
    size: 1000,
    entry: "main.js",
    write: size => ({
      "main.js":
        'const holder = { list: [{ make(n) {\n  return n % 7 === 6 ? true : { n };\n}, touch(n) {\n  if (n < 0) throw new Error("no");\n  return n;\n} }] };\nfunction large(from, held) {\n  const by = held.list[0];\n  let sum = 0;\n' +
        lines(size, index => `  const v${index} = by.make(from + ${index % 5});\n  if (v${index} === true) return ${index};`) +
        lines(size, index => `  try { sum += by.touch(from + ${index % 5}); } catch (error) { return -1; }`) +
        "  return sum;\n}\nconsole.log(large(0, holder));\n",
    }),
  },
  // Each small loop reads a list that a captured variable holds, which another closure gives another list, and all of them stand in one loop.
  // Whoever walks the outer loop for each mention of the variable in an inner one works by the inner loop times the outer one: 2,000 loops took 39,000 M instructions where 7,500 were enough.
  {
    name: "small loops over a captured list inside one loop",
    counted: "loops",
    size: 125,
    entry: "main.js",
    write: size => ({
      "main.js":
        "function make() {\n  let held = [1.5, 2.5, 3.5];\n  return {\n    total(n) {\n      let s = 0;\n      for (let t = 0; t < n; t++) {\n" +
        lines(size, () => "        for (let i = 0; i < held.length; i++) s += held[i];") +
        "      }\n      return s;\n    },\n    renew() {\n      held = held.slice();\n    },\n  };\n}\nconst box = make();\nbox.renew();\nconsole.log(box.total(2));\n",
    }),
  },
  // Every value is made above loops and read below them, and no loop changes it.
  // Whoever keeps a definition of each value at each loop that a read passes, or looks through all that he has found at a loop for each name, works by the value times the loop.
  // From 1,889 values on `mix` is called where it is taken in line below that, and a value costs a tenth more work and a quarter more memory: both sizes lie behind that step.
  {
    name: "values that stay live across loops",
    counted: "values",
    size: 2000,
    entry: "main.js",
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
  // The lists never leave, so what is known of them stays: whoever ended knowledge at a call went through what is known of every list so far.
  {
    name: "lists that one function makes and reads, between calls of what nobody knows",
    counted: "statements",
    size: 500,
    entry: "main.js",
    write: size => ({
      "main.js":
        "function large(f, o) {\n  let sum = 0;\n" +
        lines(size, i => `  const a${i} = [${i}, ${i + 1}]; f(o, ${i}); sum += a${i}.length + a${i}[0] + o.k${i % 7};`) +
        "  return sum;\n}\n" +
        "const o = { k0: 1, k1: 2, k2: 3, k3: 4, k4: 5, k5: 6, k6: 7 };\n" +
        "for (let i = 0; i < 3; i++) console.log(large(globalThis.process.argv.length > 5 ? eval : function (x) { return x; }, o));\n",
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
    write: size => ({
      "main.js": `function call(f, d) { return d ? call(f, d - 1) : f(); }\nfunction row(n) {\n  let f = () => n;\n${lines(size, index => `  if (n & ${1 << index % 20}) { const g = f; f = () => call(g, 1) + ${index}; }`)}  return call(f, 1);\n}\nlet sum = 0;\nfor (let i = 0; i < 50; i++) sum += row(i);\nconsole.log(sum);\n`,
    }),
  },
  // Which scopes a closure holds was asked by going down every capture of every closure that it captures, with no memory of what had been looked into: two to the closures.
  {
    name: "closures that each capture the one before under two names over a scope that is handed back",
    counted: "closures",
    size: 4000,
    entry: "main.js",
    write: size => ({
      "main.js": `function both(a, b) { return () => a() + b(); }\nfunction looks(job) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return typeof job === "function" ? work : 0; }\nfunction chain(take, start, wants) {\n  let total = start;\n  function add() { total++; }\n  add();\n  if (!wants) return 0;\n  const c0 = () => total;\n${lines(size, index => `  const c${index + 1} = both(c${index}, c${index});`)}  const got = take(c${size});\n  return got + 1;\n}\nconsole.log(chain(looks, 5, true), chain(looks, 5, false));\n`,
    }),
  },
  // What the ways into a join know of the fields of fresh objects was compared field by field, all that the state holds at every join: objects x joins.
  {
    name: "fresh objects that are still known at many joins behind them",
    counted: "objects",
    size: 2000,
    entry: "main.js",
    write: size => ({
      "main.js": `function wide(c) {\n${lines(size, index => `  const o${index} = { v: (c + ${index}) | 0 };`)}  let s = 0;\n${lines(size, index => `  if (c > ${index}) s = (s + 1) | 0;`)}${lines(size, index => `  s = (s + o${index}.v) | 0;`)}  return s;\n}\nconst five = JSON.parse("5");\nlet last = 0;\nfor (let t = 0; t < 200; t++) last = wide(five);\nconsole.log(last);\n`,
    }),
  },
  // Each scope that the function had made so far was carried round each later loop as a parameter of its head: scopes x loops.
  {
    name: "scopes of blocks that each have a loop which hands their closure to a helper",
    counted: "scopes",
    size: 1000,
    entry: "main.ts",
    write: size => ({
      "tsconfig.json": withoutLibraryTypes,
      "main.ts":
        declaredConsole +
        `let calls = 0;\nfunction ring(f: (x: number) => void, i: number): void {\n  let work = 0;\n  for (let j = 0; j < 2; j++) work = (work + j) | 0;\n  calls = (calls + work) | 0;\n  f(i);\n}\nfunction run(k: number): number {\n  const m = k | 0;\n  let all = 0;\n${lines(size, index => `  { let s${index}: number = 0; const add = (x: number): void => { s${index} = (s${index} + x) | 0; }; for (let i = 0; i < m; i++) ring(add, i); all = (all + s${index}) | 0; }`)}  return all;\n}\nconst three: number = JSON.parse("3");\nlet total = 0;\nfor (let t = 0; t < 200; t++) total = (total + run(three)) | 0;\nconsole.log(total, calls);\n`,
    }),
  },
  {
    name: "scopes of blocks that each have a loop which writes their variable",
    counted: "scopes",
    size: 1000,
    entry: "main.ts",
    write: size => ({
      "tsconfig.json": withoutLibraryTypes,
      "main.ts":
        declaredConsole +
        `function run(k: number, odd: any): number {\n  const m = k | 0;\n  let all = 0;\n${lines(size, index => `  { let s${index}: number = 0; const get = (): number => s${index}; for (let i = 0; i < m; i++) s${index} = (s${index} + (odd > i ? 1 : 2)) | 0; all = (all + get()) | 0; }`)}  return all;\n}\nconst three: number = JSON.parse("3");\nconst seven: any = JSON.parse("7");\nlet total = 0;\nfor (let t = 0; t < 200; t++) total = (total + run(three, seven)) | 0;\nconsole.log(total);\n`,
    }),
  },
  // A copy of the whole scope was made for each direct call of a closure over it, and read back behind the call: variables x calls, in the build and in the run.
  {
    name: "variables of one scope that closures of ten write, each closure called ten times",
    counted: "variables",
    size: 1000,
    entry: "main.js",
    write: size => ({
      "main.js": `function run(k) {\n${lines(size, index => `  let v${index} = (k + ${index}) | 0;`)}${lines(Math.ceil(size / 10), closure => `  const f${closure} = () => { let w = 0; for (let j = 0; j < 2; j++) w = (w + j) | 0;\n${upTo(Math.min(10, size - closure * 10), at => `    v${closure * 10 + at} = (v${closure * 10 + at} + w) | 0;`).join("\n")}\n  };`)}${lines(size, index => `  f${Math.floor(index / 10)}();`)}  let s = 0;\n${lines(size, index => `  s = (s + v${index}) | 0;`)}  return s;\n}\nconst three = JSON.parse("3");\nlet last = 0;\nfor (let t = 0; t < 200; t++) last = run(three);\nconsole.log(last);\n`,
    }),
  },
  // A scope that is named over thirty times has no exact count of its mentions, and the plan read on to the end of the function for each such scope: scopes x operations.
  {
    name: "scopes of blocks that each name their variable forty times",
    counted: "scopes",
    size: 250,
    entry: "main.js",
    write: size => ({
      "main.js": `function run(k) {\n  let all = 0;\n${lines(size, index => `  { let s${index} = (k + ${index}) | 0; const get = () => s${index}; ${"0123456789abcdefghij".replace(/./g, `s${index} = (s${index} + 1) | 0; `)}all = (all + get()) | 0; }`)}  return all;\n}\nconsole.log(run(JSON.parse("3")));\n`,
    }),
  },
  // From each scope the plan walked on to the first return that no keeper stands in front of, and at each return the walk went over every scope that the unit had made: scopes x blocks, scopes x returns.
  {
    name: "scopes of blocks that each may return",
    counted: "scopes",
    size: 1000,
    entry: "main.js",
    write: size => ({
      "main.js": `function take(f) { let work = 0; for (let j = 0; j < 2; j++) work = (work + j) | 0; return (f() + work) | 0; }\nfunction run(k, odd) {\n  let all = 0;\n${lines(size, index => `  { let s${index} = (k + ${index}) | 0; const get = () => s${index}; s${index} = (s${index} + 1) | 0; if (odd === ${index}) return (all + take(get)) | 0; all = (all + take(get)) | 0; }`)}  return all;\n}\nconsole.log(run(JSON.parse("3"), JSON.parse("7")));\n`,
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
      ["functions that call one another at random", 600],
      // What takes a step for each function on the way each time the way leads back to one of them shows from here on.
      ["very many functions that call one another at random", 4800],
    ] as const
  ).map(
    ([name, smallerSize]): Shape => ({
      name,
      counted: "functions",
      size: smallerSize,
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
    }),
  ),
  {
    // Whoever follows the calls from one function to the next by recursion runs out of stack on the way round.
    name: "functions that each call the next, and the last the first",
    counted: "functions",
    size: 9600,
    entry: "main.js",
    write: size => ({
      "main.js":
        lines(size, index => `function f${index}(node, depth) {\n  if (node.tag === 0) return f${(index + 1) % size}(node.next, depth + 1);\n  return node.value;\n}`) +
        `console.log(${size ? "f0({ tag: 9, value: 1, next: null }, 0)" : "1"});\n`,
    }),
  },
  // What a parameter is used as holds what the parameter of the next function is used as, and the part that is handed on nests that until the budget of a
  // parameter ends. A few names are kept in a plain list, many are not.
  ...[
    { names: 8, inWords: "nine" },
    { names: 80, inWords: "eighty-one" },
  ].map(
    ({ names, inWords }): Shape => ({
      name: `two rings of functions that read one of ${inWords} names of what they get and hand it, or a part of it, to the next`,
      counted: "functions",
      size: 1250,
      entry: "main.js",
      write: size => {
        const ring = (name: string, handedOn: string) =>
          lines(
            size,
            index =>
              `function ${name}${index}(value, steps) {\n  if (steps === 0 || value.rest === null) return value.own${index % names};\n` +
              `  return value.own${index % names} + ${name}${(index + 1) % size}(${handedOn}, steps - 1);\n}`,
          );
        return {
          "main.js":
            ring("whole", "value") +
            ring("part", "value.rest") +
            `let list = null;\nfor (let index = 0; index < 40; index++) {\n` +
            `  list = { ${upTo(names, own => `own${own}: index + ${own}`).join(", ")}, rest: list };\n}\n` +
            `console.log(${size ? "whole0(list, 50), part0(list, 39)" : "list.own4"});\n`,
        };
      },
    }),
  ),
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
  // Each test of the tag asked every member of the union what it holds under the name, read the tag anew off what the tests in front had left, and laid a name over every older name of the value.
  ...["", "  note();\n"].map(between => ({
    name: `a union of object types that is told apart by a row of ifs over a tag${between ? ", with a call between them" : ""}`,
    counted: "members",
    // The look for type errors asks for `value.kind` with a declared type of its own behind each test, and makes the property of the tag, its type and the map from tags to
    // members anew for what each test leaves of the union.
    growsSoFarInInstructions: between ? "3.56 times in instructions" : "3.60 times in instructions",
    size: 300,
    entry: "main.ts",
    write: (size: number) => ({
      "tsconfig.json": withoutLibraryTypes,
      "main.ts":
        declaredConsole +
        lines(Math.max(size, 1), index => `interface T${index} { kind: "k${index}"; v${index}: number }`) +
        `type Any = ${upTo(Math.max(size, 1), index => `T${index}`).join(" | ")};\nlet noted = 0;\nfunction note(): void { noted++; }\nfunction read(value: Any): number {\n${lines(Math.max(size, 1) - 1, index => `  if (value.kind === "k${index}") return value.v${index};\n${between}`.trimEnd())}  return value.v${Math.max(size, 1) - 1};\n}\n` +
        `const all: Any[] = [${upTo(Math.max(size, 1), index => `{ kind: "k${index}", v${index}: ${index} }`).join(", ")}];\nlet sum = 0;\nfor (const each of all) sum += read(each);\nnote();\nconsole.log(sum, noted > 0);\n`,
    }),
  })),
  // Whether all the cases of one condition come to one place was asked, for each case, by going down every name that the comparisons in front of it had given the object.
  {
    name: "texts that one condition compares a field of an object with, the object read behind it",
    counted: "comparisons",
    size: 2000,
    entry: "main.ts",
    write: size => ({
      "tsconfig.json": withoutLibraryTypes,
      "main.ts":
        declaredConsole +
        `interface Part { name: string; weight: number }\nfunction weigh(part: Part): number {\n  let extra = 0;\n  if (${upTo(Math.max(size, 1), index => `part.name === "n${index}"`).join(" || ")}) extra = part.weight;\n  return extra + part.weight;\n}\n` +
        `const all: Part[] = [{ name: "n0", weight: 1 }, { name: "other", weight: 2 }, { name: "n${Math.max(size, 1) - 1}", weight: 3 }];\nlet sum = 0;\nfor (const each of all) sum += weigh(each);\nconsole.log(sum);\n`,
    }),
  },
  // All the edges of the switch lead to one block that only hands on a constant. Whether the switch has an edge of its own to where that block leads was asked for each edge, of all the edges.
  {
    name: "texts that one condition compares a field of an object with, a constant stored behind it",
    counted: "comparisons",
    size: 2500,
    entry: "main.ts",
    write: size => ({
      "tsconfig.json": withoutLibraryTypes,
      "main.ts":
        declaredConsole +
        `interface Part { name: string; weight: number }\nfunction mark(part: Part): number {\n  let hit = 0;\n  if (${upTo(Math.max(size, 1), index => `part.name === "n${index}"`).join(" || ")}) hit = 1;\n  return hit;\n}\n` +
        `const all: Part[] = [{ name: "n0", weight: 1 }, { name: "other", weight: 2 }, { name: "n${Math.max(size, 1) - 1}", weight: 3 }];\nlet sum = 0;\nfor (const each of all) sum += mark(each);\nconsole.log(sum);\n`,
    }),
  },
  // Each `||` had all that stands to its left tested for what is always true, and each comparison went back through all the comparisons in front of it as deep as tsgo goes.
  // Past 2,000 comparisons TypeScript gives such a body up.
  {
    name: "texts that one condition compares a field of an object with, in a build that looks for type errors",
    counted: "comparisons",
    size: 900,
    entry: "main.ts",
    flags: ["--check"],
    write: size => ({
      "tsconfig.json": withoutLibraryTypes,
      "main.ts":
        declaredConsole +
        `interface Part { name: string; weight: number }\nfunction mark(part: Part): number {\n  let hit = 0;\n  if (${upTo(Math.max(size, 1), index => `part.name === "n${index}"`).join(" || ")}) hit = 1;\n  return hit;\n}\n` +
        `const all: Part[] = [{ name: "n0", weight: 1 }, { name: "other", weight: 2 }, { name: "n${Math.max(size, 1) - 1}", weight: 3 }];\nlet sum = 0;\nfor (const each of all) sum += mark(each);\nconsole.log(sum);\n`,
    }),
  },
  // The row was gone through to its end and then refused for the form of what is compared, and the next comparison began the same again.
  // In a build that looks for type errors `reading.weight` went back through every test of `reading.code` in front of it.
  ...[[], ["--check"]].map(flags => ({
    name: `a row of ifs that compare a field that holds fractions with whole numbers${flags.length ? ", in a build that looks for type errors" : ""}`,
    counted: "comparisons",
    // At a quarter of this size what the shape adds is so little that a million instructions more or less moved its growth across the bound.
    size: flags.length ? 900 : 2400,
    entry: "main.ts",
    flags,
    write: (size: number) => ({
      "tsconfig.json": withoutLibraryTypes,
      "main.ts":
        declaredConsole +
        `interface Reading { code: number; weight: number }\nfunction name(reading: Reading): number {\n${lines(size, index => `  if (reading.code === ${index}) return ${index} + reading.weight;`)}  return -1;\n}\n` +
        `const all: Reading[] = [{ code: 0.5, weight: 1 }, { code: 2, weight: 2 }, { code: ${Math.max(size, 1) - 1}, weight: 3 }];\nlet sum = 0;\nfor (const each of all) sum += name(each);\nconsole.log(sum);\n`,
    }),
  })),
  // Every variable that was built twice and lives on rode on every later edge, was asked for at the liveness there, bound at every entry and compared at every join.
  {
    name: "lines that each read one of three objects, one of them a stranger, return early if it says so and leave a variable alive to the end",
    counted: "lines",
    size: 1000,
    entry: "main.ts",
    write: size => ({
      "tsconfig.json": withoutLibraryTypes,
      "main.ts":
        declaredConsole +
        `class Item { skip: boolean; weight: number; constructor(skip: boolean, weight: number) { this.skip = skip; this.weight = weight; } }\nconst items: Item[] = [new Item(false, 2), JSON.parse('{"skip":false,"weight":3}'), new Item(false, 5)];\nfunction drive(list: Item[]): number {\n  let sum = 0;\n` +
        lines(size, index => `  const i${index} = list[${index % 3}]; if (i${index}.skip) return -1; const w${index} = i${index}.weight;`) +
        lines(size, index => `  sum = (sum + w${index}) | 0;`) +
        `  return sum;\n}\nlet last = 0;\nfor (let round = 0; round < 300; round++) last = drive(items);\nconsole.log(last);\n`,
    }),
  },
  // The way on which a guess failed comes back into the typed code at the next join. All such ways ended in one merged return, which made one rare region of them, laid in one piece:
  // each way back led back in the order of blocks and counted as a loop, one inside the other.
  {
    name: "lines that each read one of three objects, one of them a stranger, return early if it says so and add its field to a sum",
    counted: "lines",
    size: 2000,
    entry: "main.ts",
    write: size => ({
      "tsconfig.json": withoutLibraryTypes,
      "main.ts":
        declaredConsole +
        `class Item { skip: boolean; weight: number; constructor(skip: boolean, weight: number) { this.skip = skip; this.weight = weight; } }\nconst items: Item[] = [new Item(false, 2), JSON.parse('{"skip":false,"weight":3}'), new Item(false, 5)];\nfunction drive(list: Item[]): number {\n  let sum = 0;\n` +
        lines(size, index => `  const i${index} = list[${index % 3}]; if (i${index}.skip) return -1; sum = (sum + i${index}.weight) | 0;`) +
        `  return sum;\n}\nlet last = 0;\nfor (let round = 0; round < 300; round++) last = drive(items);\nconsole.log(last);\n`,
    }),
  },
  {
    // The ways on which a guess failed go on beside the way on which all held, a rung a line. Every block of the second chain has the first line for its dominator, and the climb to it
    // from line k took k steps. The code generator finds dominators only where a value that is made behind the entry is read far below.
    name: "lines that each read an element of their own, return early if it says so and add its field to a sum, with a value from the start read at the end",
    counted: "lines",
    // A line takes 12 bytes of the frame: 24,016 at 2,000 lines, 48,016 at 4,000. On arm64 its fourteen saves and as many reloads round the rare calls take 60 bytes each way at 1,000 lines and 168 at
    // 8,000: 2.21 times the bytes. Past 2 MB of code the branches to the rare ways take their long form as well, some 30 bytes a line. Below the step the shape would no longer see its square.
    frameOutgrowsOffsetsOfArm64: true,
    size: 2000,
    entry: "main.ts",
    write: size => ({
      "tsconfig.json": withoutLibraryTypes,
      "main.ts":
        declaredConsole +
        `class Item { skip: boolean; weight: number; constructor(skip: boolean, weight: number) { this.skip = skip; this.weight = weight; } }\nconst items: Item[] = [];\n` +
        `for (let index = 0; index < ${size + 1}; index++) items.push(index % 3 === 1 ? JSON.parse('{"skip":false,"weight":3}') : new Item(false, index));\n` +
        `function drive(list: Item[]): number {\n  let sum = 0;\n  let base = 1;\n  if (list.length > 2) base = list.length | 0;\n` +
        lines(size, index => `  const i${index} = list[${index}]; if (i${index}.skip) return -1; sum = (sum + i${index}.weight) | 0;`) +
        `  return (sum + base) | 0;\n}\nlet last = 0;\nfor (let round = 0; round < 300; round++) last = drive(items);\nconsole.log(last);\n`,
    }),
  },
  {
    // The class is handed out of sight, so `this` is a guess in its initializer, and behind each call the order of its keys is guessed anew. Each guess went through all the values in front of it,
    // looked each key up among the keys found so far, and each of their fields in the beginning of the order: the cube of the number of fields.
    name: "fields of a class out of sight that are each given what a call answers",
    counted: "fields",
    size: 200,
    entry: "main.js",
    write: size => ({
      "main.js":
        `const unseen = x => [x][JSON.parse("0")];\nlet heard = 0;\nconst each = unseen(i => { heard += i; });\nclass Bank {\n` +
        lines(size, index => `  v${index} = new Int32Array(8).fill(${index + 1});`) +
        `}\nfunction tally(bank, turns) {\n  let sum = 0;\n  for (let i = 0; i < turns; i++) {\n    each(i);\n` +
        lines(size, index => `    sum = (sum + bank.v${index}[i] * 3) | 0;`) +
        `  }\n  return sum;\n}\nglobalThis.kit = { Bank, tally };\nconst kit = globalThis.kit;\nconsole.log(kit.tally(new kit.Bank(), 8), heard);\n`,
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
  // Beyond 4,096 names a read ended what was known of the object, and whether the object escapes there was asked of all its uses.
  {
    name: "names of one large literal",
    counted: "names",
    size: 6000,
    entry: "main.js",
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
  // Both sizes lie behind a step. From 2,000 statements in a row on, a walk of the flow can reach the depth at which tsc gives up (MAX_FLOW_DEPTH), and the file is checked in tsc's order:
  // each statement costs Lower 0.13 M instructions from there on and 0.09 M up to there, so 1,500 and 3,000 grew 2.3 times with nothing that grows faster than the size.
  {
    name: "exports of one module that another imports by name",
    counted: "exports",
    size: 2500,
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
  {
    name: "loops in a row that hand one counter on",
    counted: "loops",
    size: 1000,
    entry: "main.js",
    write: size => ({
      "main.js": `const key = JSON.parse('"count"');\nconst table = {\n  count(${upTo(size, index => `list${index}`).join(", ")}) {\n    let seen = 0;\n${lines(size, index => `    for (let i = 0; i < list${index}.length; i++) if (list${index}[i]) seen++;`)}    return seen;\n  },\n};\nconsole.log(table[key](...Array(${size}).fill(JSON.parse('"ab"'))));\n`,
    }),
  },
  {
    name: "sums in a nest of the length of a view of two kinds",
    counted: "sums",
    size: 1000,
    entry: "main.ts",
    write: size => ({
      "main.ts": `function total(held: Uint8Array): number {\n  let sum = 0;\n  for (let i = 0; i < held.length; i++)\n    for (let j = 0; j < 2; j++) {\n${lines(size, () => `      sum += held.length;`)}    }\n  return sum;\n}\nconsole.log(total(new Uint8Array(3)), total(Buffer.from([1, 2, 3])));\n`,
    }),
  },
  // Whether a variable that closures share is written in a turn was asked of each callee's whole body, and of its callees' bodies, at each read of each loop, four times a loop:
  // 4,000 loops that call one function of 4,000 statements took the engine 13,039 M instructions where 2,000 of 2,000 took 5,175 and 1,000 of 1,000 took 2,555.
  {
    name: "loops that step a variable that closures share and call one function as long as the row of them",
    counted: "loops, and statements of the function",
    size: 1000,
    entry: "main.ts",
    write: size => ({
      "main.ts":
        `const hook: (x: number) => unknown = (globalThis as any).hook ?? ((x: number) => x);\nfunction make(start: any) {\n  let count: number = start;\n  const total: number[] = [0];\n` +
        `  function big() {\n${lines(size, index => `    hook(${index});`)}  }\n` +
        `  function run(turns: number) {\n${lines(size, () => `    for (let i = 0; i < turns; i++) { total[0] = i; count = count + 1; big(); }`)}    return count;\n  }\n` +
        `  return [run, () => count] as const;\n}\nconst [run, read] = make(JSON.parse("0"));\nconsole.log(run(2), read());\n`,
    }),
  },
  // Whether an access is split by the parts of its receiver's type goes by what all the accesses of that receiver would gain. That was counted anew at each of them, and each count
  // looked the name up among the fields: 3,200 names read off one object took the pass 9.2 s where 1,600 took 1.8.
  {
    name: "names that one loop reads off one object of two layouts",
    counted: "names",
    size: 800,
    entry: "main.js",
    write: size => ({
      "main.js": `let notes = 0;\nfunction note(v) { notes += v; }\nfunction run(o, n) {\n  let s = 0;\n  for (let i = 0; i < n; i++) {\n${lines(size, index => `    s = (s + o.table${index}[i & 3]) | 0;\n    if (s === ${-7 - 0} - ${index}) note(s);`)}  }\n  return s;\n}\nconst fields = () => ({ ${upTo(size, index => `table${index}: [1, 2, 3, ${index}]`).join(", ")} });\nconst holders = [fields(), Object.assign(Object.create(null), fields(), { more: 1 })];\nlet t = 0;\nfor (let r = 0; r < 40; r++) t += run(holders[r & 1], 50);\nconsole.log(t, notes);\n`,
    }),
  },
  // Every sum is live at every test that may fail. Whoever lists what is live at each such test lists n x n values: 1,280 sums took 28 s where 640 took 6.
  {
    name: "sums that one hot loop carries",
    counted: "sums",
    size: 1000,
    entry: "main.js",
    write: size => ({
      "main.js": `function run(a, n) {\n${lines(size, index => `  let s${index} = 0;`)}  for (let i = 0; i < n; i++) {\n${lines(size, index => `    s${index} += (i ^ ${index}) + a[(i + ${index}) & 7];`)}  }\n  return 0${upTo(size, index => ` + s${index}`).join("")};\n}\nconst a = [1, 2, 3, 4, 5, 6, 7, 8];\nlet t = 0;\nfor (let r = 0; r < 50; r++) t += run(a, 200);\nconsole.log(t);\n`,
    }),
  },
  // A loop that hands an element to a product is built twice however long it is. Whoever scans the whole loop for each value that it carries scans n x n operations: 2,000 sums took 19.9 G instructions where 1,000 took 5.9.
  {
    name: "sums that one hot loop carries beside a product of an element",
    counted: "sums",
    size: 1000,
    entry: "main.js",
    write: size => ({
      "main.js": `function run(a, n) {\n${lines(size, index => `  let s${index} = 0;`)}  let p = 1;\n  for (let i = 0; i < n; i++) {\n    p = (p * a[i & 7]) & 1023;\n${lines(size, index => `    s${index} += (i ^ ${index}) + a[(i + ${index}) & 7];`)}  }\n  return p${upTo(size, index => ` + s${index}`).join("")};\n}\nconst a = [1, 2, 3, 4, 5, 6, 7, 8];\nlet t = 0;\nfor (let r = 0; r < 50; r++) t += run(a, 200);\nconsole.log(t);\n`,
    }),
  },
  // Each counter is stepped under a condition, held against a bound of its own and added to a number of its own in a key: what stands beside a counter is looked for among the users of its names too.
  {
    name: "counters that one loop steps, each under a bound of its own, beside a product of an element",
    counted: "counters",
    size: 1000,
    entry: "main.js",
    write: size => ({
      "main.js":
        `function run(a, bounds, n) {\n` +
        lines(size, index => `  let c${index} = 0;\n  const b${index} = bounds[${index & 3}], d${index} = bounds[${(index + 1) & 3}];`) +
        `  let p = 1, s = 0;\n  for (let i = 0; i < n; i++) {\n    p = (p * a[i & 7]) & 1023;\n` +
        lines(size, index => `    if (c${index} < b${index}) c${index}++;\n    s += a[c${index} + d${index}];`) +
        `  }\n  return p + s${upTo(size, index => ` + c${index}`).join("")};\n}\nconst a = [1, 2, 3, 4, 5, 6, 7, 8];\nlet t = 0;\nfor (let r = 0; r < 3; r++) t += run(a, [1, 2, 3, 4], 5 + r);\nconsole.log(t);\n`,
    }),
  },
  // Each read and each `%` has a call on a rare path, and every value lives across thousands of them. A live range was split around the calls that it crossed, with a value of its own for
  // each call. On rare paths that cost next to nothing by the frequencies, so the register allocator walked all the calls for each value and register, and made 2,000,000 values for 8,000.
  // 34,000 values took 354 s and 3.6 GB where 27 s and 1.1 GB do, and on arm64 the list of values passed 4 GB.
  {
    name: "values that live across calls on rare paths",
    counted: "values",
    size: 8000,
    entry: "main.js",
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
  // What stands on the right is asked what its use says of it, and that asks for the type of the member on the left, which the statement before has stored, and so on up to the start.
  {
    name: "compound assignments to one member, each of a member of what nobody knows",
    counted: "assignments",
    size: 1000,
    entry: "main.js",
    write: size => ({
      "main.js": `class Meter {\n  constructor() {\n    this.total = 0;\n  }\n  add(row) {\n${lines(size, index => `    this.total += row.k${index};`)}  }\n}\nconst meter = new Meter();\nmeter.add(JSON.parse("{}"));\nconsole.log(meter.total);\n`,
    }),
  },
  // Each call leads to the handler by a rare edge. To place a rare block, the order of blocks went through all that lead to it, once for each of them.
  {
    name: "calls of what nobody knows under one try",
    counted: "calls",
    size: 3000,
    entry: "main.js",
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
    write: size => ({
      "main.js":
        "const seed = process.argv.length;\nconst h = [x => (x * 31 + seed) % 1009, x => x + seed][seed % 2];\nconst held = [{ a: 1 }, { a: 2 }, { a: 3 }];\nfunction run(k) {\n  let n = 0;\n  let v = held[seed % 3];\n  n += h(n + v.a);\n  for (let t = 0; t < 2; t++) {\n" +
        lines(size, index => `    if (k > ${index}) n += h(${index}); else n -= ${index};`) +
        "  }\n  n += h(n + v.a);\n  v = null;\n  n += h(n);\n  return n;\n}\nconsole.log(run(seed));\n",
    }),
  },
  // A branch that holds a call is a part of the function with a frame of its own where some way through the function calls nothing. At the head of each part the values that live across its
  // call ask for the registers that callees keep. To rank them, the reads of each were counted from its first to its last in the whole function, once for each branch.
  {
    name: "branches that each hold a call, in a function that some way through calls nothing",
    counted: "branches",
    size: 3000,
    entry: "main.js",
    write: size => ({
      "main.js":
        "const seed = process.argv.length;\nconst h = [x => (x * 31 + seed) % 1009, x => x + seed][seed % 2];\nfunction run(k, odd) {\n  let all = 0;\n" +
        lines(size, index => `  if (odd > ${index}) all = (all + h(k + ${index})) | 0; else all = (all + 1) | 0;`) +
        "  return all;\n}\nconsole.log(run(seed, seed));\n",
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
  // The walk to what a name stands for goes on from both arms of `c ? a : a`: without a memory of what it found from `a`, twice as long with each name.
  {
    name: "names that each stand for one of two of the one before",
    counted: "names",
    size: 10000,
    entry: "main.mjs",
    write: size => ({
      "main.mjs":
        `function Base() { if (new.target) this.tag = "base"; }\nconst pick = JSON.parse("true");\nconst a0 = pick ? Base : Base;\n` +
        lines(size, index => `const a${index + 1} = pick ? a${index} : a${index};`) +
        `class Top extends a${size} {}\nconsole.log(new Top().tag, typeof a${size}());\n`,
    }),
  },
  // Nobody reads what the choices give: their arms are empty once the dead code has gone, and each asks the same tests of `pick`. An edge is led past every test that its way has decided:
  // led from the first choice to the last, the edge out of each choice went over all the choices behind it.
  {
    name: "choices on one test whose values nobody reads",
    counted: "choices",
    size: 2500,
    entry: "main.js",
    write: size => ({
      "main.js":
        `function chosen(pick, base) {\n` +
        lines(size, index => `  const a${index + 1} = pick ? base + ${index + 1} : base - ${index + 1};`) +
        `  return base;\n}\nconsole.log(chosen(JSON.parse("true"), 1), chosen(JSON.parse("0"), 2));\n`,
    }),
  },
  // A lookup that goes up a row of classes notes a condition for each class that it passes, in a sorted list, once for each access of each constructor.
  {
    // Where the guard of a constructor's copy fails in a loop, the constructor is walked in line once more: one walk more a loop, however many loops there are.
    name: "loops that each make an object of a class of their own from rows that are not what is written",
    counted: "loops",
    size: 150,
    entry: "main.ts",
    counts: ["CopiesWalkedWhereTheirGuardsFail"],
    write: size => ({
      "tsconfig.json": withoutLibraryTypes,
      "main.ts":
        declaredConsole +
        `let sum = 0;\n` +
        lines(
          size,
          index =>
            `interface R${index} { a${index}: number; b: number; c: number; d: number; e: number }\n` +
            `class C${index} { a: number; b: number; c: number; d: number; e: number; constructor(r: R${index}) { this.a = r.a${index}; this.b = r.b; this.c = r.c; this.d = r.d; this.e = r.e; } }\n` +
            `const use${index} = (r: R${index}): number => { const made = new C${index}(r); return made.a + made.e; };\n` +
            `function total${index}(list: R${index}[]): number { let s = 0; for (let i = 0; i < list.length; i++) s += use${index}(list[i]!); return s; }\n` +
            `sum += total${index}([JSON.parse('{"a${index}":1,"b":2,"c":3,"d":4,"e":5,"more":6}'), { a${index}: 1, b: 2, c: 3, d: 4, e: 5 }]);`,
        ) +
        `console.log(sum);\n`,
    }),
  },
  {
    // A copy inside a copy prefers the second walk to leaving the copy around it. Were every level walked twice inside each walk of the level above, a level more would double the work.
    name: "classes that each make an object of the class before from a field of their row, in a loop over rows that are not what is written",
    counted: "classes",
    size: 160,
    entry: "main.ts",
    write: size => {
      const row = (level: number, more: string): string => `{"a":${level},"b":2,"c":3,"d":4,"e":5${level ? `,"next":${row(level - 1, more)}` : ""}${more}}`;
      return {
        "tsconfig.json": withoutLibraryTypes,
        "main.ts":
          declaredConsole +
          `interface R0 { a: number; b: number; c: number; d: number; e: number }\n` +
          `class C0 { a: number; b: number; c: number; d: number; e: number; constructor(r: R0) { this.a = r.a; this.b = r.b; this.c = r.c; this.d = r.d; this.e = r.e; } }\n` +
          lines(
            size,
            index =>
              `interface R${index + 1} { a: number; b: number; c: number; d: number; e: number; next: R${index} }\n` +
              `class C${index + 1} { a: number; b: number; c: number; d: number; e: number; next: C${index}; constructor(r: R${index + 1}) { this.a = r.a; this.b = r.b; this.c = r.c; this.d = r.d; this.e = r.e; this.next = new C${index}(r.next); } }`,
          ) +
          `const use = (r: R${size}): number => { const made = new C${size}(r); return made.a + made.e; };\n` +
          `function total(list: R${size}[]): number { let s = 0; for (let i = 0; i < list.length; i++) s += use(list[i]!); return s; }\n` +
          `console.log(total([JSON.parse('${row(size, ',"more":6')}'), ${row(size, "").replace(/"/g, "")}]));\n`,
      };
    },
  },
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
    // The tables of the image list every field of every class that has objects, the inherited ones too.
    growsSoFar: "3.45 times in TableBytesEmitted",
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
  // The sources of the parent of each class were gathered down the whole chain of joins before they were counted: a cube of the classes.
  {
    name: "classes below a variable that a branch in front of each may give another class",
    counted: "classes",
    size: 1000,
    entry: "main.js",
    write: size => ({
      "main.js":
        `function f(a) { let P = Object; const C = [];\n` +
        lines(size, index => `if (a > ${index + 9}) P = class {};\nC.push(class extends P {});`) +
        `return C.length; }\nconsole.log(f(process.argv.length));\n`,
    }),
  },
  // What a base lays on a new object was read once for each way down to it: where each level calls the one above twice, twice as often with every level.
  {
    name: "constructor functions in a row, each of which calls the one above twice",
    counted: "functions",
    size: 10,
    entry: "main.js",
    counts: ["BodiesReadForBirths"],
    write: size => ({
      "main.js":
        `function F0() { this.a = 1; }\n` +
        lines(size, index => `function F${index + 1}() { F${index}.call(this); F${index}.call(this); this.f${index + 1} = 1; }\nObject.setPrototypeOf(F${index + 1}.prototype, F${index}.prototype);`) +
        `function run(count) { let last; for (let i = 0; i < count; i++) last = new F${size}(); return Object.keys(last).length; }\nconsole.log(run(1));\n`,
    }),
  },
  // A base that lays nothing ends no collection, so only what is remembered of its first reading stands against two readings a level. The one at the foot names `this`: a function that does not is never read.
  {
    name: "constructor functions that store nothing in a row, each of which calls the one above twice",
    counted: "functions",
    size: 10,
    entry: "main.js",
    counts: ["BodiesReadForBirths"],
    write: size => ({
      "main.js":
        `function E0() { return this; }\n` +
        lines(size, index => `function E${index + 1}() { E${index}.call(this); E${index}.call(this); }\nObject.setPrototypeOf(E${index + 1}.prototype, E${index}.prototype);`) +
        `function Last() { E${size}.call(this); this.z = 1; }\nObject.setPrototypeOf(Last.prototype, E${size}.prototype);\n` +
        `function run(count) { let last; for (let i = 0; i < count; i++) last = new Last(); return Object.keys(last).length; }\nconsole.log(run(1));\n`,
    }),
  },
  // What super() gives was read off the result of the constructor next above. What entered at one class of the row travelled through the results of all the classes below it, each of which climbed
  // once for each class above: the flow of Link carried a square of the length of the row. With the objects in sight the classes that met at new.target brought it, out of sight every class.
  {
    name: "classes that extend one another in a row, an object of each in one list",
    counted: "classes",
    size: 60,
    entry: "main.js",
    counts: ["FactsCarriedOverEdges"],
    write: size => ({
      "main.js":
        `class C0 {}\n` +
        lines(size, index => `class C${index + 1} extends C${index} {}`) +
        `const all = [\n` +
        lines(size + 1, index => `  new C${index}(),`) +
        `];\nfunction touch(one) {\n  one.g = 1;\n}\nfor (const one of all) touch(one);\nconsole.log(Object.getOwnPropertyNames(all[all.length - 1]).length, all[0].g);\n`,
    }),
  },
  {
    name: "classes that extend one another in a row, an object of each handed out of sight",
    counted: "classes",
    size: 60,
    entry: "main.js",
    counts: ["FactsCarriedOverEdges"],
    write: size => ({
      "main.js":
        `class C0 {}\n` +
        lines(size, index => `class C${index + 1} extends C${index} {}`) +
        `const all = [\n` +
        lines(size + 1, index => `  new C${index}(),`) +
        `];\nfunction touch(one) {\n  Object.defineProperty(one, "g", { value: 1 });\n}\nfor (const one of all) touch(one);\nconsole.log(Object.getOwnPropertyNames(all[all.length - 1]).length, all[0].g);\n`,
    }),
  },
  // Whether the fields of two classes tell their objects apart is asked for each pair of classes, and the fields of a class are also those of all the classes above it.
  {
    name: "classes without fields that extend one another in a row",
    counted: "classes",
    size: 400,
    entry: "main.js",
    write: size => ({
      "main.js":
        `class C0 {\n  m0() {\n    return 0;\n  }\n}\n` +
        lines(size, index => `class C${index + 1} extends C${index} {\n  m${index + 1}() {\n    return ${index + 1};\n  }\n}`) +
        `console.log(new C${size}().m0());\n`,
    }),
  },
  // Whether only compiled classes stand above a class, whether its definition makes what its record says, how deep it stands: each was asked of each class by a walk to the top of its row, a step for
  // each pair of classes. What is left lists the pairs: the classes below each class, which are the members of its type, and the classes that have each name.
  {
    name: "classes of a module that extend one another in a long row",
    counted: "classes",
    size: 3000,
    entry: "main.js",
    write: size => ({
      "classes.js":
        `export class C0 {\n  m0() {\n    return 0;\n  }\n}\n` +
        lines(size, index => `export class C${index + 1} extends C${index} {\n  m${index + 1}() {\n    return ${index + 1};\n  }\n}`),
      "main.js": `import { C${size} as last } from "./classes.js";\nconsole.log(typeof last);\n`,
    }),
  },
  // What a function returns is proven once that is proven of the function whose result it returns: a turn a function, and no turn may look at all of them.
  {
    name: "functions that each return what the next returns, and one more",
    counted: "functions",
    size: 2000,
    entry: "main.js",
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
    // The layout of each class holds the fields of all the classes above it, so that the layouts of n classes hold n * n / 2 fields: about 300 instructions a field, a fourteenth of the build of 1,000 classes.
    // It reads 2.10 to 2.11 times, on both sides of the bound of all shapes from one build to the next. Twice as many instructions a field would read 2.2.
    mostGrowthInInstructions: 2.15,
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
    write: size => ({
      "main.js": `class C0 { set size(v) { this.kept = v; } get size() { return this.kept; } constructor() { this.f0 = 0; } }\n${lines(Math.max(size - 1, 0), index => `class C${index + 1} extends C${index} { constructor() { super(); this.f${(index + 1) % 50} = ${index + 1}; } }`)}const o = new C${Math.max(size - 1, 0)}();\nconsole.log(Object.keys(o).length, o.size, o.kept);\n`,
    }),
  },
  {
    name: "classes without members that extend one another in a row",
    counted: "classes",
    size: 1000,
    entry: "main.js",
    write: size => ({
      "main.js": `class C0 {}\n` + lines(size, index => `class C${index + 1} extends C${index} {}`) + `console.log(new C${size}() instanceof C0);\n`,
    }),
  },
  {
    name: "classes that each define a name of their own on this, below a row of classes without members",
    counted: "classes",
    size: 1000,
    entry: "main.js",
    write: size => ({
      "main.js":
        `class C0 {}\n` +
        lines(size, index => `class C${index + 1} extends C${index} {}`) +
        lines(100, index => `class D${index} extends ${index ? `D${index - 1}` : `C${size}`} { constructor() { super(); Object.defineProperty(this, "g${index}", { value: ${index} }); } }`) +
        `console.log(Object.getOwnPropertyNames(new D99()).length);\n`,
    }),
  },
  // What the objects of a class hold is listed class by class up the row: a field counts where no class further down has one of its name.
  {
    name: "functions that each make a class below the one that the function before has made",
    counted: "functions",
    size: 400,
    entry: "main.js",
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
    // As for the row of which each class is constructed.
    growsSoFar: "3.90 times in TableBytesEmitted",
    counted: "classes",
    size: 250,
    entry: "main.js",
    write: size => ({
      "main.js":
        `class C0 {\n  f0 = 0;\n}\n` +
        lines(size, index => `class C${index + 1} extends C${index} {\n  f${index + 1} = ${index + 1};\n}`) +
        `const classes = [\n` +
        lines(size + 1, index => `  C${index},`) +
        `];\nlet sum = 0;\nfor (const made of classes) sum += new made().f0;\nconsole.log(sum);\n`,
    }),
  },
  // Who read a chain of prototypes that was still being found waited for the whole of it once the chain had grown some links: a row is to cost the same a class on both sides of that length.
  {
    name: "rows of classes that functions make one below the other, by the length of a row",
    counted: "classes in each of 40 rows",
    size: 10,
    entry: "main.js",
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
    write: size => ({
      "main.js":
        `let sum = 0;\nclass First {}\nglobalThis["k" + sum] = First;\n` +
        lines(size, index => `class Base${index} {}\nclass Below${index} extends Base${index} {}\nif (new Below${index}() instanceof Base${index}) sum++;\nglobalThis["k" + sum] = Below${index};`) +
        `console.log(sum);\n`,
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
    write: size => ({
      "main.js": `function apart(list) {\n  const [${"[".repeat(size)}inmost${"]".repeat(size)}] = list;\n  return inmost;\n}\nconsole.log(apart([${"[".repeat(size)}7${"]".repeat(size)}]));\n`,
    }),
  },
  {
    name: "names that an object pattern takes, all read at the end",
    counted: "names",
    size: 16000,
    entry: "main.js",
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
    write: size => ({
      "main.js":
        `function apart(first, ${upTo(size, index => `e${index}`).join(", ")}) {\n  return [first, ${upTo(size, index => `e${index}`).join(", ")}].join();\n}\n` +
        `console.log(apart(1, ${upTo(size, index => index).join(", ")}).length, apart().length);\n`,
    }),
  },
  {
    name: "parameters of one function that each declare a type",
    counted: "parameters",
    size: 2000,
    entry: "main.ts",
    write: size => ({
      "tsconfig.json": withoutLibraryTypes,
      "main.ts":
        declaredConsole +
        `function count(first: number, ${upTo(size, index => `e${index}?: number`).join(", ")}) {\n  return first;\n}\n` +
        `console.log(count(1));\n`,
    }),
  },
  {
    name: "arguments of one call, each a sum",
    counted: "arguments",
    size: 16000,
    entry: "main.js",
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
    write: size => ({
      "main.js":
        `let sum = 0;\nlet current = null;\n` +
        lines(size, index => `class Kind${index} { weigh() { return ${index}; } }\nif ((sum & ${index}) == 0) current = new Kind${index}();\nsum += current.weigh();`) +
        `console.log(sum);\n`,
    }),
  },
  {
    // Which fields of `this` are filled is followed from block to block. Every block kept a list of all the fills so far, 12 bytes each, and a choice makes three blocks: 8,000 stores took 1.9 GB.
    // Both sizes lie in front of a step: from 4,095 names on the order of the fields is kept out of line and a store costs a sixth more. The last shape of the list lies behind it.
    name: "stores of one of two values under names of their own on this, in one constructor",
    counted: "stores",
    size: 2000,
    entry: "main.js",
    write: constructorThatStoresOneOfTwoValues,
  },
  {
    name: "statements that store a text under one name of one object",
    counted: "statements",
    size: 5000,
    entry: "main.js",
    write: size => ({
      "main.js": `const held = {};\nlet last = "";\nheld.value = "";\n${lines(size, index => `held.value = last = "text${index}";`)}console.log(held.value.length, last.length);\n`,
    }),
  },
  {
    name: "statements that store a text under one name of exports",
    counted: "statements",
    size: 5000,
    entry: "main.cjs",
    write: size => ({
      "main.cjs": `let last = "";\nexports.value = "";\n${lines(size, index => `exports.value = last = "text${index}";`)}console.log(exports.value.length, last.length);\n`,
    }),
  },
  {
    name: "statements of a method that store a text under one name of this",
    counted: "statements",
    size: 5000,
    entry: "main.js",
    write: size => ({
      "main.js": `class Held {\n  fill() {\n    let last = "";\n    this.value = "";\n${lines(size, index => `    this.value = last = "text${index}";`)}    return last;\n  }\n}\nconst held = new Held();\nconsole.log(held.fill().length, held.value.length);\n`,
    }),
  },
  {
    name: "statements that store a text under one name of a function, in a typed file",
    counted: "statements",
    size: 5000,
    entry: "main.ts",
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
    write: size => ({
      "main.js": `const name0 = "node:path";\n${lines(size, index => `const name${index + 1} = \`\${name${index}}\`;`)}console.log(require(name${size}).sep);\n`,
    }),
  },
  // A switch over an expression gives every case an edge of one terminator. Each local that a case reads which the case in front falls into went over all the edges of that terminator, once
  // to lay its argument and once to take it back: cases x cases x locals. Twice as many cases cost 2.46 times the instructions.
  {
    name: "cases of a switch over an expression that fall into one another and step four locals",
    counted: "cases",
    size: 4000,
    entry: "main.js",
    write: size => ({
      "main.js":
        `function pick(x) {\n  let a = 0, b = 1, c = 2, d = 3;\n  switch (x & 1048575) {\n` +
        lines(size, index => `    case ${index}: a += ${index}; b ^= ${index}; c = (c + ${index}) | 0; d = (d ^ c) | 0;`) +
        `  }\n  return a + b + c + d;\n}\nconsole.log(pick(JSON.parse("${Math.max(0, size - 40)}")));\n`,
    }),
  },
  {
    name: "cases of one switch that each return another number",
    counted: "cases",
    size: 4000,
    entry: "main.ts",
    write: size => ({
      "tsconfig.json": withoutLibraryTypes,
      "main.ts": `${declaredConsole}function kind(x: number) {\n  switch (x) {\n${lines(size, index => `    case ${index}:\n      return ${3 * index + 1};`)}    default:\n      return -5;\n  }\n}\nlet sum = 0;\nfor (let i = -2; i < ${size} + 2; i++) sum += kind(i);\nconsole.log(sum);\n`,
    }),
  },
  // Each case hands a constant to the switch behind it, so its way is led past that switch, straight to the case that the constant picks. To give the new edge its class, all the edges out of the
  // switch passed by were looked through, once for each way.
  {
    name: "cases of one switch that each set a state, and a switch over the state behind them",
    counted: "cases",
    size: 10000,
    entry: "main.js",
    write: size => ({
      "main.js":
        `const zero = JSON.parse("0");\nfunction route(k, bias) {\n  const base = bias | 0;\n  let state = -1;\n  switch (k) {\n` +
        lines(size, index => `    case ${index}: state = ${size - 1 - index}; break;`) +
        "  }\n  switch (state) {\n" +
        lines(size, index => `    case ${index}: return ${index * 7 + 2};`) +
        `    default: return base - 5;\n  }\n}\nlet sum = 0;\nfor (let i = -2; i < ${size + 2}; i += 997) sum += route(i, zero);\nconsole.log(sum);\n`,
    }),
  },
  // Both sizes lie in front of a step. A layout has 4,095 fields (FieldsInKeyOrder in limits.def, a width in bits). A property behind them is stored under its name, which the code then mentions:
  // three things an object for two, so 5,000 and 10,000 grew 2.4 times in ThingsMentioned with nothing that grows faster than the size.
  {
    name: "objects with a method each that one object literal holds under names of their own",
    counted: "objects",
    size: 2000,
    entry: "main.js",
    write: size => ({
      "main.js": `const table = {\n${lines(size, index => `  key${index}: { id: ${index}, name: "text${index}", run(a) { return a + ${index}; } },`)}};\nconsole.log(Object.keys(table).length);\n`,
    }),
  },
  {
    name: "texts of one union type, each a case of one switch",
    counted: "texts",
    size: 5000,
    entry: "main.ts",
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
    write: size => ({
      "main.js": `const v0 = 1;\n${lines(size, index => `const v${index + 1} = [v${index}][0];`)}if (v${size}) console.log(1);\nelse console.log(2);\n`,
    }),
  },
  {
    name: "objects with a method each in the array literal that a function makes",
    counted: "objects",
    size: 5000,
    entry: "main.js",
    write: size => ({
      "main.js": `function make(x) {\n  return [\n${lines(size, index => `    { id: x, run() { return ${index}; } },`)}  ];\n}\nconsole.log(make(1).length);\n`,
    }),
  },
  {
    name: "names of one object literal that a function fills with its argument",
    counted: "names",
    size: 10000,
    entry: "main.js",
    write: size => ({
      "main.js": `function make(x) {\n  return {\n${lines(size, index => `    key${index}: x,`)}  };\n}\nconsole.log(Object.keys(make(1)).length);\n`,
    }),
  },
  {
    name: "lines that each add a number and a text to one text, all of them known",
    counted: "lines",
    size: 10000,
    entry: "main.ts",
    write: size => ({
      "tsconfig.json": withoutLibraryTypes,
      "main.ts": `${declaredConsole}function atTheEnd(a: string, n: number): string {\n  let s = a;\n${"  s = s + n + a;\n".repeat(size)}  return s;\n}\nconsole.log(atTheEnd("x", 1).length);\n`,
    }),
  },
  {
    name: "lines that add a number of their own and a text to two texts in turns, all of them known, and hand each to a function",
    counted: "lines",
    size: 5000,
    entry: "main.ts",
    write: size => ({
      "tsconfig.json": withoutLibraryTypes,
      "main.ts": `${declaredConsole}let seen = 0;\nfunction use(text: string) {\n  seen += text.length;\n}\nfunction atTheEnd(a: string, n: number): string {\n  let s = a;\n  let t = a;\n${lines(size, index => (index % 2 ? `  s = s + (n + ${index}) + a;\n  use(s);` : `  t = t + (n + ${index}) + a;\n  use(t);`))}  return s + t;\n}\nconsole.log(atTheEnd("x", 1).length);\n`,
    }),
  },
  {
    name: "lines that each add a number and a text to one text, all of them known, and hand it to a function",
    counted: "lines",
    size: 5000,
    entry: "main.ts",
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
    // A debt: MaxInferenceNodes = 4096 holds this row in line. Without it the row grows 2.84 times: each merge goes down to the bottom of both trees.
    name: "untyped functions in a row that each hand their parameters and a member of one to the next",
    counted: "functions",
    size: 1500,
    entry: "main.js",
    write: size => ({
      "main.js": `${lines(size, index => `function f${index}(p, q) { p.mark = 0; return f${index + 1}(p.next || q, q && p); }`)}function f${size}(p, q) { return p; }\nconsole.log(typeof f0({ next: null }, { next: null }));\n`,
    }),
  },
  {
    // A debt: MaxInferenceNodes = 4096 holds this row in line. Without it a doubling costs 8 times as much (1,500 functions: 340,000 M instructions for 1,500):
    // each parameter's tree of uses is as high as the row is long and as wide as the names below it, and no two merges are alike. The bound goes when equal
    // parts of such trees are held once.
    name: "untyped functions in a row that each store under a name of their own and hand a member of each parameter to the next",
    counted: "functions",
    size: 1500,
    entry: "main.js",
    write: size => ({
      "main.js": `${lines(size, index => `function f${index}(p, q) { p.m${index} = 0; return f${index + 1}(p.next || q, q.next || p); }`)}function f${size}(p, q) { return p; }\nconsole.log(typeof f0({ next: null }, { next: null }));\n`,
    }),
  },
  {
    // With an index in place of the name all the stores fall into one part, so that each parameter's tree of uses is a chain as long as the row behind it and stays
    // under the limit on such a tree. Each merge went down the whole chain, copied it where its end grew by one, and what was copied was typed anew:
    // 1,500 functions took 7,208 M instructions where 1,141 M do.
    name: "untyped functions in a row that each store under an index of their own and hand a member of each parameter to the next",
    counted: "functions",
    size: 750,
    entry: "main.js",
    write: size => ({
      "main.js": `${lines(size, index => `function f${index}(p, q) { p[${index}] = 0; return f${index + 1}(p.next || q, q.next || p); }`)}function f${size}(p, q) { return p; }\nconsole.log(typeof f0({ next: null }, { next: null }));\n`,
    }),
  },
  {
    // What is inferred of a parameter does not hang on how often its function mentions it, and each mention is looked at once.
    name: "statements of one untyped function that each read an element of one parameter and store it into another",
    counted: "statements",
    size: 4000,
    entry: "main.js",
    write: size => ({
      "main.js": `function fill(list, other) {\n${lines(size, index => `  list[${index % 7}] = other[${index % 5}] + ${index};`)}  return list[0];\n}\nconsole.log(fill([1, 2, 3, 4, 5, 6, 7], [1, 2, 3, 4, 5]));\n`,
    }),
  },
  {
    name: "helper functions in a row that hand two constructor functions on before the last links their prototypes",
    counted: "helpers",
    size: 2000,
    entry: "main.js",
    write: size => ({
      "main.js": `${lines(size, index => `function h${index}(child, parent) { h${index + 1}(child, parent); }`)}function h${size}(child, parent) { child.prototype = Object.create(parent.prototype); }\nfunction Parent(name) { this.name = name; }\nfunction Child(name) { Parent.call(this, name); }\nh0(Child, Parent);\nconsole.log(new Child("x") instanceof Parent);\n`,
    }),
  },
  {
    name: "files that each link two constructor functions of their own through one row of as many helper functions",
    counted: "files",
    size: 500,
    entry: "main.js",
    write: size => ({
      "lib.js": `export ${lines(size, index => `function h${index}(child, parent) { h${index + 1}(child, parent); }`)}function h${size}(child, parent) { child.prototype = Object.create(parent.prototype); }\n`,
      ...Object.fromEntries(upTo(size, index => [`part${index}.js`, `import { h0 } from "./lib.js";\nexport function Parent${index}(name) { this.name = name; }\nexport function Child${index}(name) { Parent${index}.call(this, name); }\nh0(Child${index}, Parent${index});\n`])),
      "main.js": `${lines(size, index => `import { Child${index} } from "./part${index}.js";`)}let count = 0;\n${lines(size, index => `count += new Child${index}("a").name.length;`)}console.log(count);\n`,
    }),
  },
  {
    name: "helper functions in a row that each link their parameter under a parent of their own",
    counted: "helpers",
    size: 1000,
    entry: "main.js",
    write: size => ({
      "main.js": `${lines(size, index => `function B${index}() {}\nfunction h${index}(child, left) { Object.setPrototypeOf(child.prototype, B${index}.prototype); if (left > 0) h${index + 1}(child, left - 1); }`)}function h${size}(child, left) {}\nfunction Child() {}\nh0(Child, 2);\nconsole.log(Object.getPrototypeOf(Child.prototype) !== Object.prototype);\n`,
    }),
  },
  {
    name: "helper functions in a ring that each link their parameter under a parent of their own",
    counted: "helpers",
    size: 1000,
    entry: "main.js",
    write: size => ({
      "main.js": `${lines(size || 1, index => `function B${index}() {}\nfunction r${index}(child, left) { Object.setPrototypeOf(child.prototype, B${index}.prototype); if (left > 0) r${(index + 1) % (size || 1)}(child, left - 1); }`)}function Child() {}\nr0(Child, 2);\nconsole.log(Object.getPrototypeOf(Child.prototype) !== Object.prototype);\n`,
    }),
  },
  {
    name: "helper functions in a row that each link their parameter under a parent of their own and hand it on both ways",
    counted: "helpers",
    size: 500,
    entry: "main.js",
    write: size => ({
      "main.js": `function t0(child, left) {}\n${lines(size, index => `function B${index}() {}\nfunction t${index + 1}(child, left) { Object.setPrototypeOf(child.prototype, B${index}.prototype); if (left > 0) { t${index + 2}(child, left - 1); t${index}(child, left - 1); } }`)}function t${size + 1}(child, left) {}\nfunction Child() {}\nt1(Child, 2);\nconsole.log(Object.getPrototypeOf(Child.prototype) !== Object.prototype);\n`,
    }),
  },
  {
    name: "helper functions in a ring that hand two constructor functions round until one links their prototypes",
    counted: "helpers",
    size: 2000,
    entry: "main.js",
    write: size => ({
      "main.js": `${lines(size || 1, index => `function r${index}(child, parent, turns) { if (turns > 0) r${(index + 1) % (size || 1)}(child, parent, turns - 1); else child.prototype = Object.create(parent.prototype); }`)}function Parent(name) { this.name = name; }\nfunction Child(name) { Parent.call(this, name); }\nr0(Child, Parent, 5);\nconsole.log(new Child("x") instanceof Parent);\n`,
    }),
  },
  {
    name: "a chain of conditional types",
    counted: "conditional types",
    size: 10000,
    entry: "main.ts",
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
    write: size => {
      // In no regular order, and with a conversion first: each parameter is then tested again and again.
      let seed = 1;
      const draw = (below: number) => (seed = (seed * 48271) % 2147483647) % below;
      const operands = upTo(size, index => (draw(4) ? ["a", "b", "c", "(a | 0)", "(b >>> 0)"][draw(5)] : `${index}${draw(2) ? ".5" : ""}`));
      return { "main.js": `function all(a, b, c) {\n  return ${operands.join(" && ") || "a"};\n}\nconsole.log(all(1, 2, 3), all(2147483647, -2147483648, 1), all(0.5, -0, null), all(-0, -0, -0));\n` };
    },
  },
  {
    name: "operands of one && that are members and elements of parameters, numbers and conversions to int32",
    counted: "operands",
    size: 4000,
    entry: "main.js",
    write: size => {
      let seed = 1;
      const draw = (below: number) => (seed = (seed * 48271) % 2147483647) % below;
      const operands = upTo(size, index => (draw(4) ? ["a.x", "b.y", "c[0]", "(a.x | 0)", "(b.y >>> 0)"][draw(5)] : `${index}${draw(2) ? ".5" : ""}`));
      return { "main.js": `function all(a, b, c) {\n  return ${operands.join(" && ") || "a"};\n}\nconsole.log(all({ x: 1 }, { y: 2 }, [3]), all({ x: 2147483647 }, { y: -2147483648 }, [1]), all({ x: 0.5 }, { y: -0 }, [null]));\n` };
    },
  },
  {
    name: "parts that two loops join to the key of a table",
    counted: "parts",
    size: 4000,
    entry: "main.ts",
    write: size => {
      const key = ['""', ...upTo(size, index => (index % 7 === 6 ? `"p${index}"` : ["i", "`${b}`", '":"', "a.slice(1)", "b", '"-"', "a", "(i % 3)"][index % 8]))].join(" + ");
      return {
        "tsconfig.json": withoutLibraryTypes,
        "main.ts": `${declaredConsole}function look(a: any, b: any) {\n  const table: any = {};\n  for (let i = 0; i < 40; i++) table[${key}] = i;\n  let found = 0;\n  for (let i = 0; i < 40; i++) found += table[${key}] ?? -100;\n  return found;\n}\nconsole.log(look("xy", "z"), look("", ""));\n`,
      };
    },
  },
  // A loop that reckons with an element of a list is built twice whatever its size. When that mark climbed to every loop around it, each loop of a nest was bought behind its plain walk, and what
  // the loops inside had bought during that walk was thrown away and bought again: twice the work a level: 14 deep took 32,482 M instructions where 1,366 M do, and 30 deep stopped the build.
  // Twelve nests: one adds little over a million instructions a level, less than is judged.
  {
    name: "loops nested in one another over a chain that begins at an element of a list",
    counted: "loops",
    size: 16,
    entry: "main.js",
    write: size => ({
      "main.js":
        `const held = JSON.parse("[[1,2],[3,4]]");\n` +
        lines(
          12,
          nest =>
            `function run${nest}(rows) {\n  let sum = 0;\n` +
            lines(size, index => `for (let i${index} = 0; i${index} < 1; i${index}++) {`) +
            `let k = rows[0][0];\n` +
            lines(40, () => `k = k * 2 - 1;`) +
            lines(20, index => `sum += rows[k][${index & 1}];`) +
            `${"}".repeat(size)}\n  return sum;\n}`,
        ) +
        `console.log(${Array.from({ length: 12 }, (_, nest) => `run${nest}(held)`).join(" + ")});\n`,
    }),
  },
  // Loops with their test in front, nested in one another: ../parallel/what-a-build-takes-grows-with-its-program/loops-nested-hundreds-deep.js, which holds them to the square that they are today.
  // Each loop went through all that lies in it, the loops inside included, a dozen times: blocks x depth: 400 deep added 267 M instructions where 200 deep added 92.
  // Four nests: one adds 99 M instructions at 400 deep, less than is judged.
  {
    name: "loops that test at their end, nested in one another",
    counted: "loops",
    size: 200,
    entry: "main.js",
    // Judged under musl alone: there 400 loops add just over what is judged (310 M instructions), under glibc 257 M. In six builds running musl read 2.10, 2.07, 2.08, 2.08, 2.09 and 2.11 times, on both sides of the bound of all shapes, where glibc read 2.01: why musl weighs it more is not known.
    // Since then a loop no longer fills and copies the types of all that lies in it, climbs to the outermost loop, or asks about every walk around it: 1.98 under glibc, and 2.00 from 500 to 1,000 deep. TODO: once musl reads 2.05 or less the row takes the bound of all shapes again. The fault above read 2.9.
    mostGrowthInInstructions: 2.15,
    write: size => ({
      "main.js":
        lines(
          4,
          nest =>
            `function run${nest}() {\n  let sum = 0;\n` +
            lines(size, index => `let i${index} = 0; do {`) +
            `sum++;\n` +
            lines(size, index => `} while (++i${size - 1 - index} < 1);`) +
            `  return sum;\n}`,
        ) + `console.log(run0() + run1() + run2() + run3());\n`,
    }),
  },
  // A loop is walked under what is assumed of it, held against that at its back edge, and undone and walked again where it does not fit. A nest climbs together: three walks a loop at any
  // depth. When loops were looked at before they were walked, a counter that enters as 0 and widens made each depth look again through all the loops inside: 160 deep took 13,552 M
  // instructions and 320 deep 102,107 M.
  {
    name: "loops nested in one another whose bounds ask a count that the innermost steps",
    counted: "loops",
    size: 80,
    entry: "main.js",
    counts: ["WalksOfLoops", "ValuesWalked"],
    write: size => ({
      "main.js":
        `function deep(turns) {\n  let kept = 0, count = 0;\n` +
        lines(size, index => `for (let i${index} = 0; i${index} < (count < 50 ? turns : 1); i${index}++) {`) +
        `${size ? `kept = (kept + i0 + i${size - 1}) | 0; ` : ""}count++;\n${"}\n".repeat(size)}  return kept + count;\n}\nconsole.log(deep(JSON.parse("2")));\n`,
    }),
  },
  {
    name: "loops nested in one another that each read one field off an object of two layouts",
    counted: "loops",
    size: 20,
    entry: "main.js",
    counts: ["WalksOfLoops", "ValuesWalked"],
    write: size => ({
      "main.js":
        `class P { constructor(w) { this.w = w; } }\nfunction deep(p, turns) {\n  let kept = 0, count = 0;\n` +
        lines(size, index => `for (let i${index} = 0; i${index} < (count < 50 ? turns : 1); i${index}++) {\nkept = (kept + p.w) | 0;`) +
        `count++;\n${"}\n".repeat(size)}  return kept + count;\n}\nconsole.log(deep(new P(1), JSON.parse("2")), deep(JSON.parse('{"w":1}'), JSON.parse("2")));\n`,
    }),
  },
  // Behind each walk that fits, the loop around was asked whether it may be built twice, and each of its operations what a guess would prove, before its size refused it:
  // 800 loops inside one loop took the engine 606 M instructions where 400 took 231.
  // Whether a number goes through an element was asked by following the element's only user through every sum that adds no number: here through the sums of all the lines behind it,
  // for each read anew: 4,000 lines took the engine 2,551 M instructions more than 4,000 lines that add a written number, 2,000 lines 813 M.
  {
    name: "lines of one loop that each add an element and a field to one sum",
    counted: "lines",
    size: 2000,
    entry: "main.js",
    write: size => ({
      "main.js":
        `const held = JSON.parse("[1, 2, 3]");\nfunction count(o) {\n  let s = 0;\n  for (let i = 0; i < held.length; i++) {\n` +
        lines(size, () => `    s = s + (held[i] + o.k);`) +
        `  }\n  return s;\n}\nconsole.log(count(JSON.parse('{"k": 2}')));\n`,
    }),
  },
  {
    name: "loops in a row inside one loop that each add fractions to a sum of their own",
    counted: "loops",
    // Each try of a loop inside kept copies of what belongs to the loop around: a type for each of its values and a record for each variable that comes round.
    // At this size the row grew 2.25 times in instructions and 3.16 times in memory (12,800 loops: 952 MB); at a quarter of it the squares stayed under the bound.
    size: 6400,
    entry: "main.js",
    counts: ["WalksOfLoops", "ValuesWalked"],
    write: size => ({
      "main.js":
        `const unseen = x => [x][JSON.parse("0")];\nfunction run(m) {\n  let sum = 0${upTo(size, index => `, x${index} = 0`).join("")};\n  for (let r = 0; r < m; r++) {\n` +
        lines(size, index => `    for (let i = 0; i < m; i++) x${index} += i * 0.5;`) +
        `  }\n  return sum${upTo(size, index => ` + x${index}`).join("")};\n}\nconsole.log(run(unseen(3)));\n`,
    }),
  },
  {
    // Every store in a `try` block leads to the handler. Each sum read behind the `try` was followed back from every one of those stores through all the loops, and what was
    // found was kept for each place and variable; and at each block of the `try` the scan walked up to the block above the handler. 9,600 loops took 259 G instructions and
    // 9,779 MB where 9 G and 481 MB do.
    name: "loops in a row inside one loop under a try that each add fractions to a sum of their own",
    counted: "loops",
    size: 2400,
    entry: "main.js",
    write: size => ({
      "main.js":
        `const unseen = x => [x][JSON.parse("0")];\nfunction run(m) {\n  let sum = 0${upTo(size, index => `, x${index} = 0`).join("")};\n  try {\n  for (let r = 0; r < m; r++) {\n` +
        lines(size, index => `    for (let i = 0; i < m; i++) x${index} += i * 0.5;`) +
        `  }\n  } catch (error) { sum = -1; }\n  return sum${upTo(size, index => ` + x${index}`).join("")};\n}\nconsole.log(run(unseen(3)));\n`,
    }),
  },
  {
    // The sums lie in an environment and the loop around carries a product for each loop inside. For each store into the environment the walk scanned every block of the loop around;
    // leaving each loop inside, the allocator searched back over all the blocks in front of it, and kept the list of each search. 9,600 loops took 58.8 G instructions and 5,873 MB.
    // 600 loops: each loop takes 24 bytes of the frame. On arm64 a load or store reaches the first 32 KB of a frame by the offset in the instruction (4 bytes), the next 32 KB with one move
    // in front of it (8) and the rest with two (12): from 1,365 loops on the bytes grow faster than the loops (2.15 times from 1,200 loops to 2,400, 2.30 to 4,800, 2.22 to 9,600) and then
    // come back (2.08 to 19,200, 2.06 to 38,400): a step of two treads. On x64: 2.00 throughout. What is judged here rings at this size as well: 3.42 times the instructions.
    name: "loops in a row inside one loop under a try that each build a product of their own in front of the loop around",
    counted: "loops",
    size: 600,
    entry: "main.cjs",
    write: size => ({
      "main.cjs":
        `const unseen = x => [x][JSON.parse("0")];\nfunction run(m) {\n  let sum = 0${upTo(size, index => `, x${index} = 0`).join("")};\n  try {\n  for (let r = 0; r < m; r++) {\n` +
        lines(size, index => `    for (let i = 0; i < m; i++) x${index} += i * (m * ${index}.5);`) +
        `  }\n  } catch (error) { sum = -1; }\n  return sum${upTo(size, index => ` + x${index}`).join("")};\n}\nconsole.log(run(unseen(3)));\n`,
    }),
  },
  {
    // The same in a check, which must get as deep as TypeScript does to report TS2563 where TypeScript does: it took neither the leap over the stores that lead to the handler nor
    // the skip to a dominator. Now it takes both and counts what they pass. 1,800 loops took 12.1 G instructions where 0.3 G do. TypeScript checks no body of 1,999 such loops.
    name: "loops in a row inside one loop under a try that each add fractions to a sum of their own, in a check",
    counted: "loops",
    size: 900,
    entry: "main.ts",
    isCheckedAlone: true,
    write: size => ({
      "main.ts":
        `declare const m: number;\nexport function run() {\n  let sum = 0${upTo(size, index => `, x${index} = 0`).join("")};\n  try {\n  for (let r = 0; r < m; r++) {\n` +
        lines(size, index => `    for (let i = 0; i < m; i++) x${index} += i * 0.5;`) +
        `  }\n  } catch (error) { sum = -1; }\n  return sum${upTo(size, index => ` + x${index}`).join("")};\n}\n`,
    }),
  },
  {
    name: "loops in a row inside one loop under a try at the top of a file that each add fractions to a sum of their own",
    counted: "loops",
    size: 2400,
    entry: "main.js",
    write: size => ({
      "main.js":
        `const unseen = x => [x][JSON.parse("0")];\nconst m = unseen(3);\nlet sum = 0${upTo(size, index => `, x${index} = 0`).join("")};\ntry {\nfor (let r = 0; r < m; r++) {\n` +
        lines(size, index => `  for (let i = 0; i < m; i++) x${index} += i * 0.5;`) +
        `}\n} catch (error) { sum = -1; }\nconsole.log(sum${upTo(size, index => ` + x${index}`).join("")});\n`,
    }),
  },
  // All the names that are used off an object say what is expected of it. Every read of the variable asked anew, and each ask went through all the names three times: reads x names.
  // 4,000 fields took 21 G instructions.
  {
    name: "loops in a row inside one loop under a try at the top of a file that each add fractions to a field of their own of one literal",
    counted: "loops, and fields",
    size: 1200,
    entry: "main.js",
    write: size => ({
      "main.js":
        `const unseen = x => [x][JSON.parse("0")];\nconst m = unseen(3);\nlet sum = 0;\nconst o = {${upTo(size, index => `x${index}: 0`).join(", ")}};\ntry {\nfor (let r = 0; r < m; r++) {\n` +
        lines(size, index => `  for (let i = 0; i < m; i++) o.x${index} += i * 0.5;`) +
        `}\n} catch (error) { sum = -1; }\nconsole.log(sum${upTo(size, index => ` + o.x${index}`).join("")});\n`,
    }),
  },
  {
    // Each loop in the row builds a product of its own in front of the loop around. The log of the open loops kept a whole copy of the list of what is built there,
    // and of the table over it, for each try of a loop inside: 9,600 loops took 2,484 MB where 817 do.
    name: "loops in a row inside one loop that each build a product of their own in front of the loop around",
    counted: "loops",
    size: 2400,
    entry: "main.js",
    write: size => ({
      "main.js":
        `const unseen = x => [x][JSON.parse("0")];\nfunction run(m) {\n  let sum = 0${upTo(size, index => `, x${index} = 0`).join("")};\n  for (let r = 0; r < m; r++) {\n` +
        lines(size, index => `    for (let i = 0; i < m; i++) x${index} += i * (m * ${index}.5);`) +
        `  }\n  return sum${upTo(size, index => ` + x${index}`).join("")};\n}\nconsole.log(run(unseen(3)));\n`,
    }),
  },
  {
    name: "loops in a row that each turn a number of their own, and then one sum, into a fraction",
    counted: "loops",
    size: 400,
    entry: "main.js",
    counts: ["WalksOfLoops", "ValuesWalked"],
    write: size => ({
      "main.js":
        `const unseen = x => [x][JSON.parse("0")];\nfunction run(m) {\n  let sum = 0;\n` +
        lines(size, index => `  let x${index} = 0; for (let i = 0; i < m; i++) { sum += x${index}; x${index} = x${index} + 0.5; }`) +
        `  return sum;\n}\nconsole.log(run(unseen(3)));\n`,
    }),
  },
  {
    name: "loops in a row that each call a function which is copied six deep",
    counted: "loops",
    size: 40,
    entry: "main.js",
    counts: ["WalksOfLoops", "ValuesWalked"],
    write: size => ({
      "main.js":
        `const unseen = x => [x][JSON.parse("0")];\nfunction c0(a, b) { return a + b; }\n` +
        lines(5, index => `function c${index + 1}(a, b) { return c${index}(a, b) + c${index}(b, a); }`) +
        `function run(m) {\n  let sum = 0;\n` +
        lines(size, index => `  let x${index} = 0; for (let i = 0; i < m; i++) { sum += c5(x${index}, i); x${index} = x${index} + 0.5; }`) +
        `  return sum;\n}\nconsole.log(run(unseen(3)));\n`,
    }),
  },
  {
    name: "try statements with a finally block, nested in one another",
    counted: "try statements",
    size: 150,
    entry: "main.ts",
    write: size => ({
      "tsconfig.json": withoutLibraryTypes,
      "main.ts": `${declaredConsole}function run(): number {\n  let sum = 0;\n${"try {\n".repeat(size)}sum++;\n${"} finally { sum++; }\n".repeat(size)}  return sum;\n}\nconsole.log(run());\nexport {};\n`,
    }),
  },
  {
    name: "objects that a generator is sent, in one array literal",
    counted: "yields",
    size: 1000,
    entry: "main.js",
    write: size => ({
      "main.js":
        `function* all() {\n  return [${upTo(size, index => `yield ${index}`).join(", ")}];\n}\n` +
        `let count = 0;\nconst steps = all();\nlet step;\nwhile (!(step = steps.next({ count })).done) count++;\nconsole.log(count, step.value.length);\n`,
    }),
  },
  // Every place where a generator is entered again has a stack check, and the last return sites of the unit each searched the list of all those checks.
  {
    name: "yields in a row in one generator",
    counted: "yields",
    size: 8000,
    entry: "main.js",
    write: size => ({
      "main.js":
        `function* run() {\n${lines(size, index => `  yield ${index};`)}}\n` +
        `let sum = 0;\nlet count = 0;\nfor (const value of run()) {\n  sum += value;\n  count++;\n}\nconsole.log(count, sum);\n`,
    }),
  },
  // Each stretch between two suspensions looked for its first suspension from the start of the block.
  {
    name: "awaits in a row of one parameter",
    counted: "awaits",
    size: 4000,
    entry: "main.js",
    write: size => ({
      "main.js": `async function run(p) {\n  let t = 0;\n${lines(size, () => "  t += await p;")}  return t;\n}\nrun(1).then(t => console.log(t));\n`,
    }),
  },
  {
    name: "awaited calls in one array literal",
    counted: "awaits",
    size: 1000,
    entry: "main.mjs",
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
    write: size => ({
      "main.js": `let head = null;\n${lines(size, index => `head = { next: head, v${index % 7}: ${index} };`)}let count = 0;\nfor (let at = head; at; at = at.next) count++;\nconsole.log(count);\n`,
    }),
  },
  {
    name: "objects that each hold the one before, walked by a loop that stores into them",
    counted: "objects",
    size: 800,
    entry: "main.js",
    write: size => ({
      "main.js": `let head = null;\n${lines(size, index => `head = { next: head, v${index % 7}: ${index} };`)}let count = 0;\nfor (let at = head; at; at = at.next) at.place = count++;\nconsole.log(count, head?.place);\n`,
    }),
  },
  {
    name: "object literals nested in one another, walked by a loop",
    counted: "levels",
    size: 800,
    entry: "main.js",
    write: size => ({
      "main.js": `const outmost = ${"{ inner: ".repeat(size)}1${" }".repeat(size)};\nlet depth = 0;\nfor (let at = outmost; typeof at === "object"; at = at.inner) depth++;\nconsole.log(depth);\n`,
    }),
  },
  {
    name: "object literals nested in one another, each beside smaller literals",
    counted: "levels",
    size: 800,
    entry: "main.js",
    write: size => ({
      "main.js": `const unit = { width: 1 };\nconst outmost = ${"{ small: { x: unit.width }, list: [unit.width, { y: 2 }], inner: ".repeat(size)}1${" }".repeat(size)};\nlet depth = 0;\nfor (let at = outmost; typeof at === "object"; at = at.inner) depth++;\nconsole.log(depth);\n`,
    }),
  },
  // The lists have names and are read, so what is known of each is held for as long as nothing else can reach it. They leave innermost first, the one that was noted last in front: numbers that fall,
  // of which each went in front of all that the list of what is held until it ends had taken, and moved it: 1,600 lists added 1,024 M instructions and 3,200 added 2,307 M.
  {
    name: "lists with names, each read once, that leave in object literals nested in one another",
    counted: "lists",
    size: 1600,
    entry: "main.js",
    write: size => ({
      "main.js":
        `const unit = { width: 1 };\nconst k = JSON.parse("0");\nfunction make() {\n` +
        lines(size, index => `const l${index} = [unit.width, { y: 2 }];`) +
        `let read = 0;\n` +
        lines(size, index => `read += l${index}[k & 1] === 1 ? 1 : 0;`) +
        `const outmost = ${upTo(size, index => `{ list: l${index}, inner: `).join("")}1${" }".repeat(size)};\nreturn [outmost, read];\n}\n` +
        `const [outmost, read] = make();\nlet depth = 0;\nfor (let at = outmost; typeof at === "object"; at = at.inner) depth++;\nconsole.log(depth, read);\n`,
    }),
  },
  {
    name: "object literals nested in one another, handed to a generic function",
    counted: "levels",
    size: 800,
    entry: "main.ts",
    write: size => ({
      "main.ts": `function same<T>(value: T): T {\n  return value;\n}\nconst outmost = same(${"{ inner: ".repeat(size)}1${" }".repeat(size)});\nconsole.log(typeof outmost);\n`,
    }),
  },
  {
    name: "object literals nested in one another, handed to a function that keeps them constant",
    counted: "levels",
    size: 800,
    entry: "main.ts",
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
    write: size => ({
      "main.js": `const outmost = ${"{ inner: ".repeat(size)}1${" }".repeat(size)};\nconsole.log(typeof outmost.inner);\n`,
    }),
  },
  {
    name: "object literals nested in one another, where a declared type takes itself or a number",
    counted: "levels of each of five literals",
    size: 800,
    entry: "main.ts",
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
    name: "spreads of records in one literal in a loop, each behind the one before",
    counted: "spreads",
    size: 2000,
    entry: "main.ts",
    write: size => ({
      "main.ts": `type More = { request: number; user: string };\nconst sources: More[] = [{ request: 1, user: "a" }, { request: 2, user: "b" }];\nlet sum = 0;\nfor (let i = 0; i < 4; i++) {\n  const first: any = { z: i };\n  const made: any = { ...first,\n${lines(size, index => `    ...sources[(i + ${index}) & 1],`)}  };\n  sum += made.request;\n}\nconsole.log(sum);\n`,
    }),
  },
  {
    name: "literals in a loop that each spread the one before and a record",
    counted: "literals",
    size: 2000,
    entry: "main.ts",
    write: size => ({
      "main.ts": `type More = { request: number; user: string };\nconst sources: More[] = [{ request: 1, user: "a" }, { request: 2, user: "b" }];\nlet sum = 0;\nfor (let i = 0; i < 4; i++) {\n  const o0: any = { z: i };\n${lines(size, index => `  const o${index + 1}: any = { ...o${index}, ...sources[(i + ${index}) & 1] };`)}  sum += o${size}.request;\n}\nconsole.log(sum);\n`,
    }),
  },
  {
    name: "rests of patterns in one loop, each of the same row",
    counted: "patterns",
    size: 2000,
    entry: "main.js",
    write: size => ({
      "main.js": `const rows = [{ id: 1, name: "a", age: 5 }, { id: 2, name: "b", age: 6 }];\nconst kept = [];\nlet sum = 0;\nfor (let i = 0; i < 4; i++) {\n  const row = rows[i & 1];\n${lines(size, index => `  { const { id, ...rest } = row; kept[${index} & 7] = rest; sum += id; }`)}}\nconsole.log(sum + kept.length);\n`,
    }),
  },
  {
    name: "lists that each spread the one before twice",
    counted: "lists",
    size: 7,
    entry: "main.js",
    counts: ["OperationsBuilt"],
    write: size => ({
      "main.js": `function run(t) {\n  const l0 = [t, t + 1];\n${lines(size, index => `  const l${index + 1} = [...l${index}, ...l${index}];`)}  return l${size}.length;\n}\nglobalThis.handed = [run];\nconsole.log(run(1));\n`,
    }),
  },
  {
    name: "lists that each spread the one before and add an element",
    counted: "lists",
    size: 200,
    entry: "main.js",
    counts: ["OperationsBuilt"],
    write: size => ({
      "main.js": `function run(t) {\n  const l0 = [t, t + 1];\n${lines(size, index => `  const l${index + 1} = [...l${index}, t + ${index}];`)}  return l${size}.length;\n}\nglobalThis.handed = [run];\nconsole.log(run(1));\n`,
    }),
  },
  {
    name: "lists that each spread one written list and are read at the end",
    counted: "lists",
    size: 4000,
    entry: "main.js",
    write: size => ({
      "main.js": `function run(t) {\n  const l0 = [t, t + 1];\n${lines(size, index => `  const l${index + 1} = [...l0];`)}  let sum = 0;\n${lines(size, index => `  sum += l${index + 1}.length;`)}  return sum;\n}\nglobalThis.handed = [run];\nconsole.log(run(1));\n`,
    }),
  },
  {
    name: "lists that each spread one list that has grown and are read at the end",
    counted: "lists",
    size: 4000,
    entry: "main.js",
    write: size => ({
      "main.js": `function run(t) {\n  const l0 = [t, t + 1];\n  const grown = [...l0, t];\n${lines(size, index => `  const l${index + 1} = [...grown];`)}  let sum = 0;\n${lines(size, index => `  sum += l${index + 1}.length;`)}  return sum;\n}\nglobalThis.handed = [run];\nconsole.log(run(1));\n`,
    }),
  },
  {
    name: "lists in one loop that each spread a list of which nothing is known and are read at the end of the turn",
    counted: "lists",
    size: 2000,
    entry: "main.js",
    write: size => ({
      "main.js": `function run(given, turns) {\n  let sum = 0;\n  for (let r = 0; r < turns; r++) {\n${lines(size, index => `    const l${index} = [...given, r];`)}${lines(size, index => `    sum += l${index}.length;`)}  }\n  return sum;\n}\nglobalThis.handed = [run];\nconsole.log(run(JSON.parse("[1,2,3]"), 3));\n`,
    }),
  },
  {
    name: "literals that each spread the one before",
    counted: "literals",
    size: 500,
    entry: "main.js",
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
    write: recordTypesParsedFromTexts,
  },
  {
    name: "branches in a row that each assign another function to one variable",
    counted: "branches",
    size: 3000,
    entry: "main.js",
    write: size => ({
      "main.js":
        lines(size + 1, index => `function f${index}() { return ${index}; }`) +
        `function pick(n) {\n  let picked = f0;\n${lines(size, index => `  if (n > ${index + 1}) picked = f${index + 1};`)}  return picked;\n}\nconsole.log(pick(process.argv.length)());\n`,
    }),
  },
  // No node between one `seen +=` and the next is one that two others follow, so the look for type errors went down all the cases in front for each, up to the 1,000 at which it gives the function up.
  ...[6000, 400].map(size => ({
    name: `cases of one switch that each fall into the next${size < 1000 ? ", fewer than the look for type errors gives up at" : ""}`,
    counted: "cases",
    size,
    entry: "main.ts",
    write: (size: number) => ({
      "tsconfig.json": withoutLibraryTypes,
      "main.ts": `${declaredConsole}function pick(x: number): number {\n  let seen = 0;\n  switch (x) {\n${lines(size, index => `    case ${index}:\n      seen += ${index};`)}  }\n  return seen;\n}\nconsole.log(pick(JSON.parse("7")));\n`,
    }),
  })),
  {
    // Each clause falls into the next and hands the subject on, narrowed, so the machine gets a row of blocks that only jump on. Where such a row ends was asked for each of its blocks, by walking the rest of it.
    // At a third of the size what grows slowly in this build hid the square: 1.64 times.
    name: "cases of one switch that each fall into the next and hand the subject on",
    counted: "cases",
    size: 24000,
    entry: "main.ts",
    write: size => ({
      "tsconfig.json": withoutLibraryTypes,
      "main.ts": `${declaredConsole}function pick(x: number): number {\n  switch (x) {\n${lines(size, index => `    case ${index}:\n      x + ${index};`)}  }\n  return x;\n}\nconsole.log(pick(JSON.parse("7")));\n`,
    }),
  },
  {
    // Each clause falls into the next and nothing of it stays, so each case leads to an empty block that leads to the next. Where a case leads in the end was asked for each case, past all the blocks behind it.
    name: "cases of one switch that each fall into the next and leave nothing",
    counted: "cases",
    size: 8000,
    entry: "main.ts",
    write: size => ({
      "tsconfig.json": withoutLibraryTypes,
      "main.ts": `${declaredConsole}function pick(x: number, y: number): number {\n  switch (x) {\n${lines(size, index => `    case ${index}:\n      y + ${index};`)}  }\n  return y;\n}\nconsole.log(pick(JSON.parse("7"), JSON.parse("8")));\n`,
    }),
  },
  {
    // Each case is an empty block that falls into the next. Where a row of blocks that are passed by ends was asked for each edge, by walking down the row.
    name: "cases of one switch that are each an empty block",
    counted: "cases",
    size: 8000,
    entry: "main.ts",
    write: size => ({
      "tsconfig.json": withoutLibraryTypes,
      "main.ts": `${declaredConsole}function pick(x: number): number {\n  switch (x) {\n${lines(size, index => `    case ${index}: {}`)}    default: return 7;\n  }\n}\nconsole.log(pick(JSON.parse("7")));\n`,
    }),
  },
  {
    // One key may be any of the texts, and each access goes by it. The texts were all gone through for each access, although the fifth decides that they are not told apart.
    name: "texts that one key may be, and as many accesses under that key",
    counted: "texts",
    size: 8000,
    entry: "main.js",
    write: size => ({
      "main.js": `const t = { ${upTo(Math.max(size, 1), index => `k${index}: ${index}`).join(", ")} };\nfunction run(n, t) {\n  let key = "k0", s = 0;\n${lines(size, index => `  if (n > ${index + 1}) key = "k${index}";`)}${lines(size, index => `  s += t[key] + ${index};`)}  return s;\n}\nconsole.log(run(process.argv.length, t));\n`,
    }),
  },
  {
    // A store into an object that is not fresh ends what is remembered of whatever may be the same object. It asked every remembered object; those that are of another layout alone are sorted out once now.
    name: "objects out of as many makers, each of a layout of its own, each stored into",
    counted: "objects",
    size: 3000,
    entry: "main.js",
    write: size => ({
      "main.js": `let met = null;\nfunction meet(thing) {\n  met = thing;\n}\nconst kept = [];\n${lines(size, index => `function make${index}() { const o = { k${index}: 0 }; kept.push(o); return o; }\nconst o${index} = make${index}(); o${index}.k${index} = ${index}; meet(o${index});`)}console.log(typeof met);\n`,
    }),
  },
  {
    name: "objects out of one maker, each stored into",
    counted: "objects",
    size: 3000,
    entry: "main.js",
    write: size => ({
      "main.js": `let met = null;\nfunction meet(thing) {\n  met = thing;\n}\nconst kept = [];\nfunction make(i) { const o = { k: 0, i }; kept.push(o); return o; }\n${lines(size, index => `const o${index} = make(${index}); o${index}.k = ${index}; meet(o${index});`)}console.log(typeof met);\n`,
    }),
  },
  {
    name: "literals of as many layouts that have left before they are stored into",
    counted: "objects",
    size: 3000,
    entry: "main.js",
    write: size => ({
      "main.js": `let met = null;\nfunction meet(thing) {\n  met = thing;\n}\n${lines(size, index => `const o${index} = { k${index}: 0 }; meet(o${index}); o${index}.k${index} = ${index};`)}console.log(typeof met);\n`,
    }),
  },
  {
    name: "literals of one layout that have left before they are stored into",
    counted: "objects",
    size: 3000,
    entry: "main.js",
    write: size => ({
      "main.js": `let met = null;\nfunction meet(thing) {\n  met = thing;\n}\n${lines(size, index => `const o${index} = { k: 0 }; meet(o${index}); o${index}.k = ${index};`)}console.log(typeof met);\n`,
    }),
  },
  {
    name: "literals of as many layouts that have left, read and stored into",
    counted: "objects",
    size: 3000,
    entry: "main.js",
    write: size => ({
      "main.js": `let met = null;\nfunction meet(thing) {\n  met = thing;\n}\nlet sum = 0;\n${lines(size, index => `const o${index} = { k${index}: ${index}, j${index}: 0 }; meet(o${index}); sum += o${index}.k${index}; o${index}.j${index} = sum;`)}console.log(sum);\n`,
    }),
  },
  {
    // What an operation writes into an object ends what is remembered under the bit of its slot, and the bit goes by the key: with one key in as many layouts every store went through every object met before, twice.
    // Places whose object is of their layout alone stand in a chain of that layout and bit now, and a store into an object of one layout alone goes through its own chain.
    name: "literals of as many layouts with one key in common that have left before it is stored into",
    counted: "objects",
    size: 3000,
    entry: "main.js",
    write: size => ({
      "main.js": `let met = null;\nfunction meet(thing) {\n  met = thing;\n}\nlet sum = 0;\n${lines(size, index => `const o${index} = { k: 0, a${index}: 0 }; meet(o${index}); o${index}.k = ${index}; sum += o${index}.k;`)}console.log(sum);\n`,
    }),
  },
  {
    name: "objects out of as many makers with one key in common, which is stored into",
    counted: "objects",
    size: 3000,
    entry: "main.js",
    write: size => ({
      "main.js": `let met = null;\nfunction meet(thing) {\n  met = thing;\n}\nconst kept = [];\n${lines(size, index => `function make${index}() { const o = { k: 0, a${index}: 0 }; kept.push(o); return o; }\nconst o${index} = make${index}(); o${index}.k = ${index}; meet(o${index});`)}console.log(typeof met);\n`,
    }),
  },
  {
    name: "objects of as many classes below one base, whose field is stored into",
    counted: "objects",
    size: 1500,
    entry: "main.js",
    write: size => ({
      "main.js": `let met = null;\nfunction meet(thing) {\n  met = thing;\n}\nlet sum = 0;\nclass Base { k = 0; }\n${lines(size, index => `class C${index} extends Base { a${index} = 0; }\nconst o${index} = new C${index}(); meet(o${index}); o${index}.k = ${index}; sum += o${index}.k;`)}console.log(sum);\n`,
    }),
  },
  {
    // A factor of one in 64 hid a square in this shape at 1,500 objects (2.06) and showed it at 6,000 (2.22): so it is read there too.
    name: "twice as many literals of as many layouts that have left before they are stored into",
    counted: "objects",
    size: 6000,
    entry: "main.js",
    write: size => ({
      "main.js": `let met = null;\nfunction meet(thing) {\n  met = thing;\n}\n${lines(size, index => `const o${index} = { k${index}: 0 }; meet(o${index}); o${index}.k${index} = ${index};`)}console.log(typeof met);\n`,
    }),
  },
  {
    // A store that creates a field writes the words of the object's shape, so it ends the shapes and the facts of whatever may be the same object. It went through every object with a shape or such a fact and was told no by each.
    // A writer of one object of one layout alone goes by the objects that may be it now: those nobody can tell apart, those of its layout, and, where it is a cell made here, that cell alone.
    name: "literals of as many layouts that have left, each given a name more",
    counted: "objects",
    size: 3000,
    entry: "main.js",
    write: size => ({
      "main.js": `let met = null;\nfunction meet(thing) {\n  met = thing;\n}\n${lines(size, index => `const o${index} = { k${index}: 0 }; meet(o${index}); o${index}.l${index} = ${index};`)}console.log(typeof met);\n`,
    }),
  },
  {
    name: "literals of one layout that have left, each given a name more",
    counted: "objects",
    size: 3000,
    entry: "main.js",
    write: size => ({
      "main.js": `let met = null;\nfunction meet(thing) {\n  met = thing;\n}\n${lines(size, index => `const o${index} = { k: 0 }; meet(o${index}); o${index}.l = ${index};`)}console.log(typeof met);\n`,
    }),
  },
  {
    name: "objects out of as many makers, each given a name more",
    counted: "objects",
    size: 3000,
    entry: "main.js",
    write: size => ({
      "main.js": `const kept = [];\n${lines(size, index => `function make${index}() { const o = { k${index}: 0 }; kept.push(o); return o; }\nconst o${index} = make${index}(); o${index}.l${index} = ${index};`)}console.log(kept.length);\n`,
    }),
  },
  {
    name: "objects out of one maker, each given a name more",
    counted: "objects",
    size: 3000,
    entry: "main.js",
    write: size => ({
      "main.js": `const kept = [];\nfunction make(i) { const o = { k: 0, i }; kept.push(o); return o; }\n${lines(size, index => `const o${index} = make(${index}); o${index}.l = ${index};`)}console.log(kept.length);\n`,
    }),
  },
  {
    name: "instances of one class that have left, each given a name more",
    counted: "objects",
    size: 3000,
    entry: "main.js",
    write: size => ({
      "main.js": `let met = null;\nfunction meet(thing) {\n  met = thing;\n}\nclass C { constructor(i) { this.i = i; } }\n${lines(size, index => `const o${index} = new C(${index}); meet(o${index}); o${index}.l = ${index};`)}console.log(typeof met);\n`,
    }),
  },
  {
    // A store into an object that is still fresh searches nobody for what may be the same object. Null laid above a literal at its birth took that away: each store went through every object met before.
    name: "literals below null, each stored into right behind",
    counted: "objects",
    size: 3000,
    entry: "main.js",
    write: size => ({
      "main.js": `let met = { __proto__: null };\nfunction meet(thing) {\n  met = thing;\n}\n${lines(size, index => `const o${index} = { __proto__: null, j${index}: 0 }; o${index}.j${index} = ${index}; meet(o${index});`)}console.log(typeof met);\n`,
    }),
  },
  {
    name: "objects made by Object.create, each stored under a name right behind",
    counted: "objects",
    size: 3000,
    entry: "main.js",
    write: size => ({
      "main.js": `let met = Object.create(null);\nfunction meet(thing) {\n  met = thing;\n}\n${lines(size, index => `const o${index} = Object.create(null); o${index}.k${index} = ${index}; meet(o${index});`)}console.log(typeof met);\n`,
    }),
  },
  {
    // Each member is expected to run on the literal or on what is created below it: that list is made once a literal, not once a member.
    name: "members of one literal, with as many objects created below it",
    counted: "members",
    size: 2000,
    entry: "main.js",
    write: size => ({
      "main.js": `const base = {\n${lines(size, index => `  m${index}() { return this.a${index} | 0; },`)}};\nglobalThis.kept = base;\nlet sum = 0;\n${lines(size, index => `const c${index} = Object.create(base); c${index}.a${index} = ${index}; sum += c${index}.m${index}();`)}console.log(sum);\n`,
    }),
  },
  {
    name: "objects made by Object.create that nothing is stored under",
    counted: "objects",
    size: 3000,
    entry: "main.js",
    write: size => ({
      "main.js": `let met = Object.create(null);\nfunction meet(thing) {\n  met = thing;\n}\n${lines(size, index => `const o${index} = Object.create(null); meet(o${index});`)}console.log(typeof met);\n`,
    }),
  },
  {
    name: "names that a pattern takes out of a literal in front of its rest",
    counted: "names",
    size: 4000,
    entry: "main.js",
    write: size => ({
      "main.js": `const { ${upTo(size, index => `a${index}, `).join("")}...rest } = { ${upTo(2 * size + 2, index => `a${index}: ${index}`).join(", ")} };\nconsole.log(Object.keys(rest).length);\n`,
    }),
  },
  {
    name: "labels of one switch that share one body",
    counted: "labels",
    size: 20000,
    entry: "main.ts",
    write: size => ({
      "tsconfig.json": withoutLibraryTypes,
      "main.ts": `${declaredConsole}function pick(x: number): number {\n  let seen = 0;\n  switch (x) {\n${lines(Math.max(size, 1), index => `    case ${index}:`)}      seen += 1;\n  }\n  return seen;\n}\nconsole.log(pick(JSON.parse("7")));\n`,
    }),
  },
  {
    name: "lists that meet in one variable, and another name read off it behind each",
    counted: "lists",
    size: 4000,
    entry: "main.js",
    write: size => ({
      "main.js": `let met = [];\nlet seen = 0;\nfunction meet(list) {\n  met = list;\n}\n${lines(size, index => `meet([${index}]); if (met.k${index}) seen++;`)}console.log(seen);\n`,
    }),
  },
  {
    name: "cases of one switch that each assign another text to one variable",
    counted: "cases",
    // At a quarter of this size what the shape adds is so little that a million instructions more or less moved its growth across the bound.
    size: 12000,
    entry: "main.js",
    write: size => ({
      "main.js": `function pick(n) {\n  let picked = "t";\n  switch (n) {\n${lines(size, index => `    case ${index}: picked = "t${index}"; break;`)}  }\n  return picked;\n}\nconsole.log(pick(process.argv.length));\n`,
    }),
  },
  {
    name: "branches in a row that each assign another function of the language to one variable",
    counted: "branches",
    size: 3000,
    entry: "main.js",
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
    write: size => ({
      "main.js":
        lines(size + 1, index => `const s${index} = Symbol("s${index}");`) +
        `function pick(n) {\n  let picked = s0;\n${lines(size, index => `  if (n > ${index + 1}) picked = s${index + 1};`)}  return picked;\n}\n` +
        "console.log(String(pick(process.argv.length).description));\n",
    }),
  },
  {
    // The turns of each loop are written out. Each loop asked every block of the body whether it is a handler block, looked for what is read behind it among all the values up to the end of the body,
    // and left what it defines in a list that every later edge went through.
    name: "short counted loops one behind the other in one function",
    counted: "loops",
    size: 2000,
    entry: "main.js",
    write: size => ({
      "main.js":
        "function run(v) {\n  let s = 0;\n" +
        lines(size, index => `  for (let i = 0; i < 3; i++) s += v[i] + ${index};`) +
        "  return s;\n}\nconsole.log(run([1, 2, 3]), run([4, 5, 6]));\n",
    }),
  },
  {
    // A copy whose turns are written out walks each call of a turn once a turn. Where that call was copied for its own turns, eight times as much was walked for each function of the chain.
    name: "functions that each call the next in a counted loop, with a bound that the caller writes",
    counted: "functions",
    size: 1000,
    entry: "main.js",
    write: size => ({
      "main.js":
        "function f0(n) { let s = 0; for (let i = 0; i < n; i++) s += i; return s; }\n" +
        lines(size, index => `function f${index + 1}(n) { let s = 0; for (let i = 0; i < n; i++) s += f${index}(8); return s; }`) +
        `console.log(f${size}(0));\n`,
    }),
  },
  {
    name: "functions that each call the next for each of the arguments that the caller writes",
    counted: "functions",
    size: 1000,
    entry: "main.js",
    write: size => ({
      "main.js":
        "function f0(...v) { let s = 0; for (const x of v) s += x; return s; }\n" +
        lines(size, index => `function f${index + 1}(...v) { let s = 0; for (const x of v) s += f${index}(x, 1, 2, 3, 4, 5, 6, 7); return s; }`) +
        `console.log(f${size}());\n`,
    }),
  },
  {
    name: "loops over the names of a record one behind the other in one function",
    counted: "loops",
    size: 2000,
    entry: "main.js",
    write: size => ({
      "main.js":
        "function run(p) {\n  let s = 0;\n" +
        lines(size, index => `  for (const k in p) s += p[k] + ${index};`) +
        "  return s;\n}\nconsole.log(run({ x: 1, y: 2, z: 3 }), run({ x: 4, y: 5, z: 6 }));\n",
    }),
  },
  {
    // `target[k] = source[k]` is followed name by name. Each name cost flow a lookup with all its nodes, also in a table that is only ever walked.
    name: "names of tables that one helper copies in a for-in, none of them named by any operation",
    counted: "names",
    size: 20000,
    entry: "main.js",
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
    write: size => ({
      "main.js":
        `function pick(n) {\n  let picked = "t0";\n${lines(size, index => `  if (n > ${index + 1}) picked = "t${index + 1}";`)}  return picked;\n}\n` +
        "console.log(pick(process.argv.length));\n",
    }),
  },
  // For each package that loads by a name the build does not know, the search for the files that such a load may find went through every file of the program
  // and everything that it imports: 2000 packages of seven files took 16 seconds to bind. No file is found here, so that what is counted is the search.
  {
    name: "packages that each load by a name that they are given",
    counted: "packages",
    size: 1000,
    entry: "main.js",
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
    write: size => ({
      "main.mjs":
        `const seed = process.argv.length;\nfunction g(x) { return (x * 31 + seed) % 1009; }\nconst h = [g, x => x + seed][seed % 2];\n` +
        `function big() {\n  let s = 0;\n  for (let k = 0; k < 3; k++) {\n    switch ((seed * 7 + k) % ${size + 1}) {\n` +
        lines(size, index => `      case ${index}: s += h(${index}); break;`) +
        `    }\n  }\n  return s;\n}\nconsole.log(big());\n`,
    }),
  },
  {
    // A case that falls into the next makes the next a place where ways meet, so one switch has half as many of those as cases. Whoever asked at each of them whether all sides of the switch meet there went through all the cases.
    name: "cases of one switch in a loop that each call what nobody knows, every second one falling into the next",
    counted: "cases",
    size: 1000,
    entry: "main.mjs",
    write: size => ({
      "main.mjs":
        `const seed = process.argv.length;\nfunction g(x) { return (x * 31 + seed) % 1009; }\nconst h = [g, x => x + seed][seed % 2];\n` +
        `function big() {\n  let s = 0;\n  for (let k = 0; k < 3; k++) {\n    switch ((seed * 7 + k) % ${size + 1}) {\n` +
        lines(size, index => `      case ${index}: s += h(${index});${index % 2 ? " break;" : ""}`) +
        `    }\n  }\n  return s;\n}\nconsole.log(big());\n`,
    }),
  },
  {
    // What is called is read on every edge out of the switch, and those reads lie between a case and the one read that counts for it, at the foot of the loop. Whoever asked in each case whether it is read again went over all of them.
    name: "cases of one switch in a loop that each call what nobody knows and fall into the next",
    counted: "cases",
    size: 1000,
    entry: "main.mjs",
    counts: ["LaterReadsAskedWhetherTheyCount"],
    write: size => ({
      "main.mjs":
        `const seed = process.argv.length;\nfunction g(x) { return (x * 31 + seed) % 1009; }\nconst h = [g, x => x + seed][seed % 2];\n` +
        `function big() {\n  let s = 0;\n  for (let k = 0; k < 3; k++) {\n    switch ((seed * 7 + k) % ${size + 1}) {\n` +
        lines(size, index => `      case ${index}: s += h(${index});`) +
        `    }\n  }\n  return s;\n}\nconsole.log(big());\n`,
    }),
  },
  // No case stands above another, so each converts the value anew. Whoever asked for a conversion of it went through all that the cases before had made.
  {
    name: "cases of one switch in a loop that each take one integer as a fraction",
    counted: "cases",
    size: 4000,
    entry: "main.mjs",
    write: size => ({
      "main.mjs":
        `const seed = process.argv.length;\nfunction big(x) {\n  let s = 0.5;\n  for (let k = 0; k < 3; k++) {\n    switch ((seed * 7 + k) % ${size + 1}) {\n` +
        lines(size, index => `      case ${index}: s += x * ${index}.5; break;`) +
        `    }\n  }\n  return s;\n}\nconsole.log(big(seed | 0));\n`,
    }),
  },
  {
    name: "cases of one switch in a loop that each read one field of one object",
    counted: "cases",
    size: 4000,
    entry: "main.mjs",
    write: size => ({
      "main.mjs":
        `const seed = process.argv.length;\nfunction big(o) {\n  let s = 0;\n  for (let k = 0; k < 3; k++) {\n    switch ((seed * 7 + k) % ${size + 1}) {\n` +
        lines(size, index => `      case ${index}: s += o.a + ${index}; break;`) +
        `    }\n  }\n  return s;\n}\nconsole.log(big({ a: seed, b: 2 }));\n`,
    }),
  },
  // What each case brings to the end of the switch is converted on its way there, which is noted last of all: far behind what all the ways have. Each meet went through the empty stretch between.
  {
    name: "cases of one switch in a loop that each compute one sum of two parameters",
    counted: "cases",
    size: 8000,
    entry: "main.mjs",
    write: size => ({
      "main.mjs":
        `const seed = process.argv.length;\nfunction big(a, b) {\n  let s = 0;\n  for (let k = 0; k < 3; k++) {\n    switch ((seed * 7 + k) % ${size + 1}) {\n` +
        lines(size, index => `      case ${index}: s ^= (a + b) | ${index}; break;`) +
        `    }\n  }\n  return s;\n}\nconsole.log(big(seed | 0, 3));\n`,
    }),
  },
  // What comes round to the head is followed through 32 values and no further. Whoever counts them only behind the meeting of all the cases has held each of n values against the n in front of it.
  {
    name: "cases of one switch in a loop that each compute one sum beside a product of an element",
    counted: "cases",
    size: 8000,
    entry: "main.mjs",
    write: size => ({
      "main.mjs":
        `const seed = process.argv.length;\nfunction big(a, b, list) {\n  let s = 0, p = 1;\n  for (let k = 0; k < 3; k++) {\n    p = (p * list[k]) & 1023;\n    switch ((seed * 7 + k) % ${size + 1}) {\n` +
        lines(size, index => `      case ${index}: s ^= (a + b) | ${index}; break;`) +
        `    }\n  }\n  return s + p;\n}\nconsole.log(big(seed | 0, 3, [3, 5, 7]));\n`,
    }),
  },
  {
    // Behind each comparison that fails the variable is none of the numbers so far: what flow is told of it grows with each statement.
    name: "statements in a loop that each compare one variable with another number",
    counted: "statements",
    size: 4000,
    entry: "main.mjs",
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
    counts: ["RegExpsCompiled"],
    write: size => ({
      "main.js":
        `const texts = [\n` +
        lines(size, index => `  "^(?:alpha|beta)${index}[a-z0-9_]{1,40}(?:-gamma|-delta)+$",`) +
        `  "^x$",\n];\nlet hits = 0;\nfor (let index = 0; index < texts.length; index++) if (new RegExp(texts[(index + process.argv.length) % texts.length]).test("x")) hits++;\nconsole.log(hits);\n`,
    }),
  },
  {
    // As a validator does: a family of functions that call one another hand a description round, and each makes a pattern of a member of it. The walk that worked a pattern's text out came to
    // the end of its budget in the family, and began anew at the next call.
    name: "validator patterns",
    counted: "functions",
    size: 100,
    entry: "main.js",
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
    name: "alternatives of one regular expression",
    counted: "alternatives",
    size: 4000,
    entry: "main.js",
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
  // All of them are read behind the loop. Whoever lists them and looks through the list for each has looked at n x n.
  {
    name: "texts that move up one place in every turn of a loop beside a product of an element",
    counted: "texts",
    size: 8000,
    entry: "main.js",
    write: size => ({
      "main.js":
        `function run(list, numbers, turns) {\n` +
        lines(size + 1, index => `  let v${index} = "0";`) +
        `  let sum = 0, p = 1;\n  for (let i = 0; i < turns; i++) {\n    p = (p * numbers[i & 3]) & 1023;\n    sum += v0.length;\n` +
        lines(size, index => `    v${index} = v${index + 1};`) +
        `    v${size} = list[i];\n  }\n` +
        lines(size + 1, index => `  sum += v${index}.length;`) +
        `  return sum + p;\n}\nconst list = [];\nfor (let i = 0; i < ${size + 9}; i++) list.push("s" + i);\nconsole.log(run(list, [3, 5, 7, 9], ${size + 9}));\n`,
    }),
  },
  // Which text a loop grows is followed block by block. Whoever keeps, for each block, a place for each value that might be a text, and goes through all of them on every edge, has blocks x values:
  // 8,000 sums took 40.0 G instructions where 4,000 took 13.4, and at 20,000 the table passed what a list can hold and the build died.
  {
    name: "sums of unknown kind that one loop carries, each behind a branch that is never taken",
    counted: "sums",
    // No square. On arm64 a sum takes 137 machine operations and 40 spills at every size from 500 to 32,000, and one more sum takes 1,205 bytes of code up to 1,000 sums, 1,340 at 4,000, 1,710 up to 8,000 and 2,040
    // from 12,000 on, level to 32,000 (1.98 times). The two steps of 380 are a word of the frame, which takes two instructions past 32,760 bytes above the stack pointer and three past 65,535: a sum takes
    // 16 bytes of the frame, 63,888 at 4,000 sums and 127,888 at 8,000, and all of the rise lies in saves and reloads: 2.30 times the bytes. On x64 it takes 1,036 bytes throughout.
    frameOutgrowsOffsetsOfArm64: true,
    size: 4000,
    entry: "main.cjs",
    write: size => ({
      "main.cjs":
        `"use strict";\nconst list = []; for (let i = 0; i < 64; i++) list.push(i + 0.25);\nfunction big(list, rare) {\n  let unused = 0${upTo(size, index => `, v${index} = 0`).join("")};\n  for (let turn = 0; turn < 3; turn++) {\n` +
        lines(size, index => `    if (rare) Object.setPrototypeOf(list, null); v${index} = v${index} + list[${index % 64}];`) +
        `  }\n  let sum = unused;\n` +
        lines(size, index => `  sum = (sum * 33 + v${index}) % 1000000007;`) +
        `  return sum;\n}\nconsole.log(big(list, process.argv.length > 99));\n`,
    }),
  },
  // Here every one of them is a text and stays one to the end. Whoever lays them into builders and asks once a text what hangs on the loop alone (what is live, the ways out), or looks through all texts on every edge,
  // goes n x n steps.
  {
    name: "texts that one loop grows, each on both arms of a branch",
    counted: "texts",
    size: 2000,
    entry: "main.cjs",
    write: size => ({
      "main.cjs":
        `"use strict";\nfunction big(parts, turns) {\n  let unused = ""${upTo(size, index => `, t${index} = ""`).join("")};\n  for (let turn = 0; turn < turns; turn++) {\n` +
        lines(size, index => `    if (turn & ${1 + (index & 1)}) t${index} += parts[${index & 3}]; else t${index} += "-";`) +
        `  }\n  let sum = unused.length;\n` +
        lines(size, index => `  sum = (sum * 33 + t${index}.length) % 1000000007;`) +
        `  return sum;\n}\nconsole.log(big(["a", "bc", "def", "ghij"], 5));\n`,
    }),
  },
  // Whether a computed key begins with a written text is asked by going down the left operands of the sums that made it. Whoever goes down the whole chain for each key goes n x n steps.
  {
    name: "links of a chain of sums, each the key of a read",
    counted: "links",
    size: 8000,
    entry: "main.js",
    write: size => ({
      "main.js":
        `function run(rows, k0) {\n  let s = 0;\n` +
        lines(size, index => `  const k${index + 1} = k${index} + 1; s += rows[k${index + 1}][0];`) +
        `  return s;\n}\nconst rows = Array.from({ length: ${size + 2} }, (_, i) => [i & 7]);\nconsole.log(run(rows, 0));\n`,
    }),
  },
  {
    // An object that is one of two lives on under the name of the join. Allocation removal took all of them through every block.
    name: "calls of what nobody knows beside variables that each hold one of two object literals",
    counted: "calls",
    size: 2000,
    entry: "main.mjs",
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
    name: "thousands of objects that are one of two and lie in the frame, each read once behind as many branches",
    counted: "objects",
    size: 3000,
    entry: "main.mjs",
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
    // A quarter as many objects as statements stay alive through all of it.
    name: "one function called in a loop that reads objects again and again, with stores to their fields between",
    counted: "statements",
    size: 500,
    entry: "main.mjs",
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
    // The reads are tested and the tests' proofs are handed on. Each call was asked about every proof, one by one, though a call that may write anything ends
    // every proof about an object that came out of the heap.
    name: "objects out of the heap whose lists of numbers are read again and again in a warm body, a call between the reads",
    counted: "reads",
    size: 250,
    entry: "main.mjs",
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
  // Loops with written bounds were written out turn by turn, and what was left was a row of joins without a cycle. A type that changed went on to the users of its value depth first, so a value behind
  // n joins was typed 2^n times, each time with a range that no value had had before: eight turns around three took four minutes and 17 GB.
  {
    name: "turns of a loop with a written bound around a short loop that holds a try and a finally",
    counted: "turns of the outer loop",
    size: 2,
    entry: "main.js",
    counts: ["ValuesWalked", "OperationsBuilt"],
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
    write: size => ({
      "main.js": size
        ? lines(Math.ceil(size / 4), index => `class T${index} { constructor() { this.size = ${index}; } m${index}(x) { return (x + this.size) & 7; } }`) +
          `const things = [${upTo(Math.ceil(size / 4), index => `new T${index}()`).join(", ")}];\nfunction all(k) {\n  let s = k;\n` +
          lines(size, index => `  s += things[${index % Math.ceil(size / 4)}].m${index % Math.ceil(size / 4)}(s + ${index});`) +
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
    write: size => ({
      "main.js":
        `function big(x, n, o) {\n  let s = 0;\n  for (let i = 0; i < n; i++) {\n` +
        lines(size, index => `    s = (s + x) | 0; if (s === -${(index + 1) * 7919}) continue;`) +
        `    x = (x + o.step) | 0;\n  }\n  return s + x;\n}\nconsole.log(big(5, 3, { step: 7 }), big(0, 3, { step: 7 }), big(-9, 2, { step: -1 }));\n`,
    }),
  },
  {
    name: "records whose fields are stored behind their literals in one body",
    counted: "literals",
    size: 2000,
    entry: "main.ts",
    write: size => ({
      "main.ts":
        `type Made = { a: number; b?: number };\nconst out: Made[] = [];\nfunction take(o: Made) { out.push(o); }\nfunction build(seed: number) {\n` +
        lines(size, index => `  const o${index}: Made = { a: seed + ${index} }; o${index}.b = ${index}; take(o${index});`) +
        `}\nbuild(1);\nlet total = 0;\nfor (let i = 0; i < out.length; i++) total += out[i].a + out[i].b!;\nconsole.log(total);\n`,
    }),
  },
  // What a spread copies was read anew for each spread, object by object, and for an object of a list that is written as data the whole list was walked to find it:
  // the cube of the size: 2000 objects and 2000 spreads took 800,000 million instructions in one step of flow's results.
  {
    name: "spreads of an element of one list",
    counted: "objects, and as many spreads",
    size: 250,
    entry: "main.js",
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
  // ---- Much of one thing in ONE body, class or literal, as a large program has it. Each prints one number.
  // KNOWN, AND NO SHAPE HERE: loops and ifs INSIDE one another: each look at a loop looks again at every loop inside it, so the work is the cube of the depth: 285 deep took 70,000 M instructions. No program is that deep.
  {
    name: "constants of a module that are each made of the one before, by a call on one of two ways",
    counted: "constants",
    size: 10000,
    entry: "main.ts",
    write: size => ({
      "tsconfig.json": withoutLibraryTypes,
      "main.ts": `${declaredConsole}function step(x: number): number { return (x * 31 + 7) % 1000003; }\nconst c0 = step(1);\n${lines(size, index => `const c${index + 1} = c${index} % 3 ? step(c${index}) : step(c${index} + 1);`)}console.log(c${size});\n`,
    }),
  },
  {
    name: "locals of one function that are each stored on two ways",
    counted: "locals",
    size: 5000,
    entry: "main.ts",
    write: size => ({
      "tsconfig.json": withoutLibraryTypes,
      "main.ts": `${declaredConsole}function run(seed: number): number {\n  let l0 = seed;\n${lines(size, index => `  let l${index + 1} = l${index} + ${index + 1}; if (l${index + 1} & 1) l${index + 1} = l${index + 1} * 3 % 65521; else l${index + 1} = l${index} ^ ${index + 1};`)}  return l${size};\n}\nconsole.log(run(5));\n`,
    }),
  },
  {
    name: "keys of one literal that are each stored and read again by name",
    counted: "keys",
    size: 5000,
    entry: "main.ts",
    write: size => ({
      "tsconfig.json": withoutLibraryTypes,
      "main.ts": `${declaredConsole}const o = {\n  k: 0,\n${lines(size, index => `  k${index}: ${index},`)}};\nlet sum = o.k;\n${lines(size, index => `o.k${index} = o.k${(index * 7) % size} + 1; sum += o.k${index};`)}console.log(sum);\n`,
    }),
  },
  {
    name: "small objects of one shape in one list literal",
    counted: "objects",
    size: 10000,
    entry: "main.ts",
    write: size => ({
      "tsconfig.json": withoutLibraryTypes,
      "main.ts": `${declaredConsole}const list = [\n  { id: -1, name: "n", weight: 0.5, on: true },\n${lines(size, index => `  { id: ${index}, name: "n${index}", weight: ${index % 17} + 0.5, on: ${index % 2 ? "true" : "false"} },`)}];\nlet sum = 0;\nfor (const item of list) sum += item.on ? item.weight : item.id;\nconsole.log(sum);\n`,
    }),
  },
  {
    name: "cases of one switch on a number, asked in a loop",
    counted: "cases",
    size: 10000,
    entry: "main.ts",
    write: size => ({
      "tsconfig.json": withoutLibraryTypes,
      "main.ts": `${declaredConsole}function pick(x: number): number {\n  switch (x) {\n${lines(size, index => `    case ${index}: return ${(index * 13) % 101};`)}    default: return -1;\n  }\n}\nlet sum = 0;\nfor (let i = 0; i < ${size}; i += 7) sum += pick(i);\nconsole.log(sum);\n`,
    }),
  },
  // What Link knows of a constructor grows with the classes that call it, and each class had that looked through anew for each constructor above it: 12,000 classes took 25,400 M instructions where 9,200 M do.
  {
    name: "classes with a method each that extend one class, each constructed once",
    counted: "classes",
    size: 3000,
    entry: "main.ts",
    write: size => ({
      "tsconfig.json": withoutLibraryTypes,
      "main.ts":
        `${declaredConsole}abstract class Base { abstract area(): number; }\n` +
        lines(size, index => `class C${index} extends Base { constructor(public a: number, public b${index % 5}: number) { super(); } area(): number { return this.a * this.b${index % 5} + ${index}; } }`) +
        `const all: Base[] = [];\n` +
        lines(size, index => `all.push(new C${index}(${index}, 2));`) +
        `let sum = 0;\nfor (const one of all) sum += one.area();\nconsole.log(sum);\n`,
    }),
  },
  // Both sizes on one side of the 4,095 fields that an object lists: past them a field is stored by name, which costs more: 3,000 and 6,000 fields read 2.15 times, 1,500 and 3,000 read 2.00, 6,000 and 12,000 read 2.02.
  {
    name: "fields and methods of one class, each method called once",
    counted: "fields",
    size: 1500,
    entry: "main.ts",
    write: size => ({
      "tsconfig.json": withoutLibraryTypes,
      "main.ts":
        `${declaredConsole}class Wide {\n  f: number = 0;\n${lines(size, index => `  f${index}: number = ${index};`)}${lines(size, index => `  m${index}(): number { return this.f${index} + this.f${(index * 11) % size}; }`)}}\n` +
        `const w = new Wide();\nlet sum = w.f;\n${lines(size, index => `sum += w.m${index}();`)}console.log(sum);\n`,
    }),
  },
  {
    name: "static fields and static methods of one class, each field read and stored once",
    counted: "static fields, and static methods",
    size: 5000,
    entry: "main.js",
    write: size => ({
      "main.js":
        `class Table {\n  static first = 0;\n${lines(size, index => `  static m${index}() { return ${index}; }`)}${lines(size, index => `  static k${index} = ${index};`)}}\nlet sum = Table.first;\n` +
        `${lines(size, index => `sum += Table.k${index}; Table.k${index} = sum;`)}console.log(sum, Object.keys(Table).length);\n`,
    }),
  },
  {
    name: "static fields and static methods of one class that a test run defines",
    counted: "static fields, and static methods",
    size: 10000,
    entry: "a.test.js",
    isTestRun: true,
    write: size => ({
      "package.json": `{ "name": "p", "type": "module" }\n`,
      "a.test.js":
        `import { expect, test } from "bun:test";\n` +
        `class Table {\n  static first = 0;\n${lines(size, index => `  static m${index}() { return ${index}; }`)}${lines(size, index => `  static k${index} = ${index};`)}}\n` +
        `test("it has them", () => {\n  expect(Object.keys(Table).length).toBe(${size + 1});\n});\n`,
    }),
  },
  // A field without a type and without a value takes its type from what the constructor stores, and the constructor was sought among all members anew for each field; each store on this went through
  // all members for one that is only declared: fields x fields, twice. 32,000 fields took 26 G instructions, and take 3.8. Both sizes lie past the 4,095 fields that an object lists.
  {
    name: "fields of one class that are written without a value, each stored by the constructor behind them",
    counted: "fields",
    size: 8000,
    entry: "main.js",
    write: size => ({
      "main.js": `class Wide {\n${lines(size, index => `  f${index};`)}  constructor(v) {\n${lines(size, index => `    this.f${index} = v;`)}  }\n}\nconsole.log(new Wide(1).f0);\n`,
    }),
  },
  // A name whose first store is compound takes its type from the first store of that name that is not, and all stores were gone through for it: names x stores: half of the build at 32,000.
  // Both sizes lie past the 4,095 fields that an object lists, and the build holds too little for its memory to be judged: at 8,000 and 16,000 it held 88 MB more than nothing, 8 under what is judged.
  {
    name: "names that the constructor stores on this by compound stores alone",
    counted: "names",
    size: 6000,
    entry: "main.js",
    write: size => ({
      "main.js": `class Wide {\n  constructor(v) {\n${lines(size, index => `    this.f${index} += v;`)}  }\n}\nconsole.log(String(new Wide(1).f0));\n`,
    }),
  },
  // The same of static fields: the static blocks were sought among all members anew for each. 32,000 took 29 G instructions, and take 5.8.
  // At these sizes the build holds too little for its memory to be judged. At 8,000 and 16,000 that was judged, and one compiler read 1.96 to 2.10 times in eight runs: the instructions were the same in all.
  {
    name: "static fields of one class that are written without a value, each stored by a static block behind them",
    counted: "static fields",
    size: 4000,
    entry: "main.js",
    write: size => ({
      "main.js": `class Table {\n${lines(size, index => `  static s${index};`)}  static {\n${lines(size, index => `    Table.s${index} = ${index};`)}  }\n}\nconsole.log(Table.s0);\n`,
    }),
  },
  {
    name: "closures of one function that each write a local of their own and one that all share",
    counted: "closures",
    size: 5000,
    entry: "main.ts",
    write: size => ({
      "tsconfig.json": withoutLibraryTypes,
      "main.ts": `${declaredConsole}function make(): Array<() => number> {\n  let shared = 0;\n  const out: Array<() => number> = [];\n${lines(size, index => `  let v${index} = ${index}; out.push(() => { shared += v${index}; v${index}++; return shared; });`)}  return out;\n}\nlet sum = 0;\nfor (const f of make()) sum += f();\nconsole.log(sum);\n`,
    }),
  },
  {
    name: "try blocks in a row in the body of a module",
    counted: "blocks",
    size: 5000,
    entry: "main.ts",
    write: size => ({
      "tsconfig.json": withoutLibraryTypes,
      "main.ts": `${declaredConsole}function risky(x: number): number { if (x % 1000 === 999) throw new Error("no"); return x + 1; }\nlet sum = 0;\n${lines(size, index => `try { sum += risky(${index}); } catch (e) { sum -= 1; }`)}console.log(sum);\n`,
    }),
  },
  {
    name: "loops of three kinds in a row in the body of a module",
    counted: "loops",
    size: 5000,
    entry: "main.ts",
    write: size => ({
      "tsconfig.json": withoutLibraryTypes,
      "main.ts":
        `${declaredConsole}const data = [3, 1, 4, 1, 5, 9, 2, 6];\nlet sum = 0;\n` +
        lines(size, index =>
          index % 3 === 0 ? `for (const x of data) sum += x * ${index};` : index % 3 === 1 ? `for (let i = 0; i < data.length; i++) sum += data[i] + ${index};` : `{ let k = ${index % 5}; while (k-- > 0) sum += k; }`,
        ) +
        `console.log(sum);\n`,
    }),
  },
  // The length is one value for all the loops, and each loop by index narrows it for its own turns; each loop that counts down leaves a name behind that holds in all that follows. Whoever looked for a name of the length
  // went along that list, or asked each of its names whether the list holds it. And a set of numbers that held one old number wrote a word of zeros for each 64 numbers up to each new one, at every loop.
  // 20,000 loops took 19,700 M instructions where 12,100 M do.
  {
    name: "loops up to the length of one list, each behind a loop that counts down",
    counted: "loops",
    size: 5000,
    entry: "main.ts",
    write: size => ({
      "tsconfig.json": withoutLibraryTypes,
      "main.ts":
        `${declaredConsole}const data = [3, 1, 4, 1, 5, 9, 2, 6];\nlet sum = 0;\n` +
        lines(size, index => (index % 2 ? `for (let i = 0; i < data.length; i++) sum += data[i] + ${index};` : `{ let k = ${index % 5}; while (k-- > 0) sum += k; }`)) +
        `console.log(sum);\n`,
    }),
  },
  {
    name: "calls of two small functions in one body, each of which may be copied into it",
    counted: "calls",
    size: 5000,
    entry: "main.ts",
    write: size => ({
      "tsconfig.json": withoutLibraryTypes,
      "main.ts":
        `${declaredConsole}function add(a: number, b: number): number { return a + b; }\nfunction scale(p: { x: number, y: number }, k: number): { x: number, y: number } { return { x: p.x * k, y: p.y + k }; }\n` +
        `function run(): number {\n  let p = { x: 1, y: 2 };\n  let t = 0;\n${lines(size, index => `  p = scale(p, ${(index % 3) + 1}); t = add(t, p.x % 7);`)}  return t + p.y;\n}\nconsole.log(run());\n`,
    }),
  },
  // All of it is known to folding, and the text passes the longest that folding makes. Past that length each line left a join behind that nobody read, with a text of its own of up to that length, and the known end of the
  // text was written out anew at each line: 20,000 lines took 35,400 M instructions where 10,000 took 1,400 M.
  {
    name: "lines that each add a text and a number to one text, all of them known, past the longest text that is made",
    counted: "lines",
    // That length is 65,536 characters. A line in front of it is folded away and a line behind it is a join that is emitted, which costs a fifth more: so the text begins behind it, at every size.
    size: 10000,
    entry: "main.ts",
    write: size => ({
      "tsconfig.json": withoutLibraryTypes,
      "main.ts": `${declaredConsole}let s = "${"x".repeat(65536)}";\nlet k = 1;\n${lines(size, index => `s = s + "p${index}" + k; k = (k * 7 + ${index}) % 11;`)}console.log(s.length);\n`,
    }),
  },
  {
    name: "functions that each call the one before, the one before that, and one that all call",
    counted: "functions",
    size: 5000,
    entry: "main.ts",
    write: size => ({
      "tsconfig.json": withoutLibraryTypes,
      "main.ts":
        `${declaredConsole}function leaf(x: number): number { return x % 9973; }\nfunction f0(x: number): number { return leaf(x); }\n` +
        lines(size, index => `function f${index + 1}(x: number): number { return x & 1 ? f${index}(x + ${index + 1}) : leaf(x) + f${Math.max(0, index - 1)}(x >> 1); }`) +
        `console.log(f${Math.min(size, 24)}(12345));\n`,
    }),
  },
  {
    name: "literals with a name of their own each that one list holds under one type",
    counted: "literals",
    size: 2500,
    entry: "main.ts",
    write: size => ({
      "tsconfig.json": withoutLibraryTypes,
      "main.ts":
        `${declaredConsole}type Any = { tag: number, common: number };\nconst all: Any[] = [];\n` +
        lines(size, index => `all.push({ tag: ${index}, common: ${index % 13}, own${index}: ${index} } as Any);`) +
        `let sum = 0;\nfor (const one of all) { sum += one.common; one.common = one.tag; }\n` +
        lines(size, index => `sum += all[${index}].common + all[${index}].tag;`) +
        `console.log(sum);\n`,
    }),
  },
  {
    name: "closures that are set in one Map under texts of their own",
    counted: "closures",
    size: 5000,
    entry: "main.ts",
    write: size => ({
      "tsconfig.json": withoutLibraryTypes,
      "main.ts":
        `${declaredConsole}const table = new Map<string, (x: number) => number>();\n` +
        lines(size, index => `table.set("e${index}", (x) => x + ${index});`) +
        `let sum = 0;\nfor (let i = 0; i < ${size}; i += 3) sum += table.get("e" + i)!(i);\nconsole.log(sum);\n`,
    }),
  },
  // What the compiler knows of an object stays known until something may have written the object, also where the program has long dropped it. A function with a loop is called, not copied into its caller,
  // and is known to write nothing: so a long row of statements comes to know something of thousands of objects. Whatever ended knowledge went through all of them:
  // objects x stores. 4,000 rows took 6.4 G instructions where 3.7 G do.
  {
    name: "objects that are each handed to a function with a loop, with a store into a variable behind each",
    counted: "objects",
    // At a quarter of this size what the shape adds is so little that a million instructions more or less moved its growth across the bound.
    size: 8000,
    entry: "main.js",
    write: size => ({
      "main.js": rowBehindAFunctionWithALoop(size, index => `sum += pick({ k: ${index}, next: null }, 0).k;`),
    }),
  },
  // The store ends what is known of the same field of every object that may be the same one.
  {
    name: "objects that are each handed to a function with a loop and stored into through what it returns",
    counted: "objects",
    size: 2000,
    entry: "main.js",
    write: size => ({
      "main.js": rowBehindAFunctionWithALoop(size, index => `{ const o = pick({ k: ${index}, next: null }, 0); o.k = ${index + 1}; }`),
    }),
  },
  // A slot under another layout may be the same slot, so the object beside them is asked about at each store, and none of the others.
  {
    name: "objects that are each handed to a function with a loop and stored into, beside one object of another layout",
    counted: "objects",
    size: 2000,
    entry: "main.js",
    write: size => ({
      "main.js": rowBehindAFunctionWithALoop(
        size,
        index => `{ const o = pick({ k: ${index}, next: null }, 0); o.k = ${index + 1}; }`,
        "const other = pick({ a: 1, b: 2, next: null }, 0);\nsum += other.a + other.b;\n",
      ),
    }),
  },
  // The new name ends the shape of each object that may be the same one, and most of what is known of its cell.
  {
    name: "objects that are each handed to a function with a loop and get a new name through what it returns",
    counted: "objects",
    size: 2000,
    entry: "main.js",
    write: size => ({
      "main.js": rowBehindAFunctionWithALoop(size, index => `{ const o = pick({ k: ${index}, next: null }, 0); o.j = ${index + 1}; }`),
    }),
  },
  {
    name: "instances that are each handed to a function with a loop, with a call of a method that stores to this behind each",
    counted: "instances",
    size: 2000,
    entry: "main.js",
    write: size => ({
      "main.js": rowBehindAFunctionWithALoop(
        size,
        index => `{ const o = pick(new C(${index}), 0); o.bump(1); }`,
        "class C { constructor(k) { this.k = k; this.next = null; } bump(n) { while (n-- > 0) this.k++; return this.k; } }\n",
      ),
    }),
  },
  {
    name: "closures that are each handed to a function with a loop, with a store into what they capture behind each",
    counted: "closures",
    // At a quarter of this size what the shape adds is so little that a million instructions more or less moved its growth across the bound.
    size: 8000,
    entry: "main.js",
    write: size => ({
      "main.js": rowBehindAFunctionWithALoop(size, index => `{ let c = ${index}; const f = () => c++; pick({ k: f, next: null }, 0); c += 1; }`),
    }),
  },
  // Each branch copies what is known, writes the copy, and the two meet again: what makes the stores cheap must not be made anew in each copy.
  {
    name: "objects that are each handed to a function with a loop, with a branch that stores into a variable behind each",
    counted: "objects",
    size: 4000,
    entry: "main.js",
    write: size => ({
      "main.js": rowBehindAFunctionWithALoop(size, index => `{ const o = pick({ k: ${index}, next: null }, 0); if (o.k > sum) sum += 1; }`),
    }),
  },
  // A variable with two writers is known by what was last read from it. A store into a variable ends what is known of those that share its bit, and went through all that are known to find them:
  // variables x stores. Each row stores twice, into flags: what a row adds beside that is little.
  {
    name: "variables of a module that a function stores into, each read once with two stores into others behind it",
    counted: "variables",
    size: 2000,
    entry: "main.js",
    write: size => ({
      "main.js":
        lines(size, index => `let v${index} = 0;`) +
        `let odd = false, even = false;\nfunction set(x) {\n` +
        lines(size, index => `  v${index} = x;`) +
        `}\nfunction show() { console.log(odd, even); }\nset(1);\n` +
        lines(size, index => `odd = v${index} === 1; even = !odd;`) +
        `show();\n`,
    }),
  },
  // What is held of a variable stays behind a store into another one, whichever bit of the heap the two fall on. A store went through all that are held under its bit to leave them there: variables x stores / 64.
  // 5,000 | 10,000 | 20,000 | 40,000 | 80,000 variables took 1.87 | 3.20 | 6.22 | 13.66 | 34.37 G instructions; it shows from 20,000 on.
  {
    name: "variables of a module that one function stores into one after another, all of them held",
    counted: "variables",
    size: 20000,
    entry: "main.js",
    write: size => ({
      "main.js":
        lines(size, index => `let v${index} = 0;`) +
        `function run(n) {\n` +
        lines(size, index => `  v${index} = n + ${index};`) +
        `  return v0;\n}\nconst all = () => {\n  let sum = 0;\n` +
        lines(size, index => `  sum += v${index};`) +
        `  return sum;\n};\nrun(process.argv.length);\nconsole.log(all());\n`,
    }),
  },
  // Behind a test of its type a local has a name of its own, and behind the next test a name behind that one. Whoever goes from a name back to the value, or to what is expected of it, by way of all the names
  // between takes tests x tests.
  {
    name: "tests of the type of one parameter in a row, each of which returns what it reads off the parameter",
    counted: "tests",
    size: 2000,
    entry: "main.js",
    write: size => ({
      "main.js":
        `function pick(x, n) {\n` +
        lines(size, index => `  if (${["Array.isArray(x)", `typeof x === "string"`, "x === null", "x === undefined", `typeof x === "function"`][index % 5]} && n === ${index}) return [x, ${index}];`) +
        `  return x;\n}\nconsole.log(pick(process.argv, process.argv.length), pick("text", 1), pick(null, 2));\n`,
    }),
  },
  {
    name: "tests of the type of one parameter in a row whose arms read it and meet again",
    counted: "tests",
    size: 2000,
    entry: "main.js",
    write: size => ({
      "main.js":
        `function sum(x) {\n  let total = 0;\n` +
        lines(size, index => `  if (${["Array.isArray(x)", `typeof x === "string"`, "x != null"][index % 3]}) total += x.length + ${index}; else total -= ${index};`) +
        `  return total;\n}\nconsole.log(sum(process.argv), sum("text"), sum(null));\n`,
    }),
  },
  {
    name: "tests of the type of one parameter that fail one behind the other, with all the arms meeting at the end",
    counted: "tests",
    size: 2000,
    entry: "main.js",
    write: size => ({
      "main.js":
        `function sum(x, n) {\n  let total = 0;\n  if (x === undefined) return 0;\n  ` +
        upTo(size, index => `if (${["Array.isArray(x)", `typeof x === "string"`, "x === null", `typeof x === "number"`][index % 4]} && n === ${index}) total = [x, ${index}];`).join("\n  else ") +
        `\n  return [total, x];\n}\nconsole.log(sum(process.argv, process.argv.length), sum("text", 1), sum(null, 2));\n`,
    }),
  },
  {
    name: "tests of the type of one parameter joined by ||",
    counted: "tests",
    size: 2000,
    entry: "main.js",
    write: size => ({
      "main.js":
        `function pick(x, n) {\n  if (x === undefined) return 0;\n  if (n < 0` +
        upTo(size, index => ` ||\n      (${["Array.isArray(x)", `typeof x === "string"`, "x === null", `typeof x === "number"`][index % 4]} && n === ${index})`).join("") +
        `) return [x];\n  return x;\n}\nconsole.log(pick(process.argv, process.argv.length), pick("text", 1), pick(null, 2));\n`,
    }),
  },
  // The guard lets the whole union through, and the look that plans it follows every name that a test leaves.
  {
    name: "statements that each tell a text from a list, of one parameter that is written as either",
    counted: "statements",
    size: 1000,
    entry: "main.ts",
    write: size => ({
      "tsconfig.json": withoutLibraryTypes,
      "main.ts":
        declaredConsole +
        `function count(value: string | number[], rounds: number): number {\n  let total = 0;\n  for (let round = 0; round < rounds; round++) {\n` +
        lines(size, index => `    if (Array.isArray(value)) total += value.length + ${index}; else total += value.length - ${index};`) +
        `  }\n  return total;\n}\nconsole.log(count("text", 2), count([1, 2, 3], 2));\n`,
    }),
  },
  {
    name: "loops over the units of one parameter that is written as a text or a list, each behind a test for a text",
    counted: "loops",
    size: 500,
    entry: "main.ts",
    write: size => ({
      "tsconfig.json": withoutLibraryTypes,
      "main.ts":
        declaredConsole +
        `function count(value: string | number[]): number {\n  let total = 0;\n` +
        lines(size, index => `  if (typeof value === "string") for (const unit of value) total += unit.length + ${index}; else total += value.length;`) +
        `  return total;\n}\nconsole.log(count("text"), count([1, 2, 3]));\n`,
    }),
  },
  // The head of each loop is expected to hold what the checker says of it, and the checker's walk for what is looped over went back through the tests of every statement in front:
  // 1,000 loops took 3,768 M instructions where 1,084 M do.
  {
    name: "loops over the units of one field that is written as a text or a list, each behind a test for a text",
    counted: "loops",
    size: 500,
    entry: "main.ts",
    write: size => ({
      "tsconfig.json": withoutLibraryTypes,
      "main.ts":
        declaredConsole +
        `function count(holder: { value: string | number[] }): number {\n  let total = 0;\n` +
        lines(size, index => `  if (typeof holder.value === "string") for (const unit of holder.value) total += unit.length + ${index}; else total += holder.value.length;`) +
        `  return total;\n}\nconsole.log(count({ value: "text" }), count({ value: [1, 2, 3] }));\n`,
    }),
  },
  {
    name: "lists made at the head of one function, each pushed onto in a loop of its own, all named again in the return",
    counted: "lists",
    size: 500,
    entry: "main.ts",
    write: size => ({
      "tsconfig.json": withoutLibraryTypes,
      "main.ts":
        declaredConsole +
        `function many(n: number, change: (k: number) => number): number[][] {\n` +
        lines(size, index => `  const l${index}: number[] = [];`) +
        lines(size, index => `  for (let k = 0; k < n; k++) l${index}.push(change(k));`) +
        `  return [${upTo(size, index => `l${index}`).join(", ")}];\n}\n` +
        `const changes = [(k: number) => k, (k: number) => k * 2];\nlet total = 0;\nfor (let round = 0; round < 4; round++) for (const list of many(3, changes[round % 2])) total += list.length;\nconsole.log(total);\n`,
    }),
  },
  // The checker looked for a name of a list that grows through the mutations of every other list: 4,000 lists took 12.2 G instructions where 3.4 G do.
  {
    name: "lists without a type that each grow in one statement, each read and stored again behind all of them",
    counted: "lists",
    size: 2000,
    entry: "main.js",
    write: size => ({
      "main.js":
        `function large(n, s) {\n` +
        lines(size, index => `  const l${index} = []; l${index}.push(n, n, n, n, n, n, n, n);`) +
        lines(size, index => `  l${index}[0] = l${index}[s[0] & 7] + 1;`) +
        `  return ${size ? "l0[0]" : "n"};\n}\nconsole.log(large(process.argv.length + 8, [1, 2, 3]));\n`,
    }),
  },
  // The same with a loop around what makes each grow: the checker walked through all the loops behind it. Twice the size stays below the 2,000 labels of a body that is given up.
  {
    name: "lists without a type that each grow in a loop of their own, each read and stored again behind all of them",
    counted: "lists",
    size: 900,
    entry: "main.js",
    write: size => ({
      "main.js":
        `function large(n, s) {\n` +
        lines(size, index => `  const l${index} = []; for (let k = 0; k < n; k++) l${index}.push(1);`) +
        lines(size, index => `  l${index}[0] = l${index}[s[0] & 7] + 1;`) +
        `  return ${size ? "l0[0]" : "n"};\n}\nconsole.log(large(process.argv.length + 8, [1, 2, 3]));\n`,
    }),
  },
  // A loop that is built twice asked every handler of the body whether it reads what the loop makes, and each loop over a list has a handler of its own:
  // 2,000 loops took 6,377 M instructions where 1,947 M do. So did each block whose end is walked for each way, for what is read behind it: 8,000 loops took 10,066 M where 7,477 M do.
  // And each loop that is tried copied, for the case that the try is undone, the list of all values that the loops in front of it had built twice: 8,000 loops took 13,835 M where 12,437 M do.
  {
    name: "loops in a row over one parameter that is written as a list of texts",
    counted: "loops",
    // At half this size that copy stayed within the bound.
    size: 4000,
    entry: "main.ts",
    write: size => ({
      "tsconfig.json": withoutLibraryTypes,
      "main.ts":
        declaredConsole +
        `function count(value: string[]): number {\n  let total = 0;\n` +
        lines(size, index => `  for (const unit of value) total += unit.length + ${index};`) +
        `  return total;\n}\nconsole.log(count(["text"]), count(["a", "b", "c"]));\n`,
    }),
  },
  {
    // Whoever follows the names noted the call of the resolver at every reading and walked its notes at every question: elements x elements.
    name: "elements of a list that go on from the folder of what one require.resolve() answers",
    counted: "elements",
    size: 2000,
    entry: "main.cjs",
    write: size => ({
      "main.cjs":
        `const path = require("node:path");\nconst root = path.dirname(require.resolve("some-package/package.json"));\nlet count = 0;\nfor (const file of [\n` +
        lines(size, () => `  path.join(root, "lib", "part.cjs"),`) +
        `]) count += require(file).one;\nconsole.log(count);\n`,
      "node_modules/some-package/package.json": `{ "name": "some-package", "version": "1.0.0" }\n`,
      "node_modules/some-package/lib/part.cjs": "exports.one = 1;\n",
    }),
  },
  {
    // In a test run a static is asked by the byte of its member. Other code between two statics ends what the test has shown: the next guess was opened inside the stretch
    // of the one before, and each built a closed arm of its own over all that was left of the block: statements x statements.
    name: "statements in one block of a loop that each call a static on what an unknown function answers, in a test run",
    counted: "statements",
    size: 1000,
    entry: "a.test.ts",
    isTestRun: true,
    write: size => ({
      "package.json": `{ "name": "p", "type": "module" }\n`,
      "a.test.ts":
        `import { expect, test } from "bun:test";\nconst step: (x: number) => number = (globalThis as any).madeUpStep ?? ((x: number) => x + 0.5);\n` +
        `function chained(turns: number): number {\n  let s = 0;\n  for (let at = 0; at < turns; at++) {\n${lines(size, () => `    s += Math.floor(step(s));`)}  }\n  return s;\n}\n` +
        `test("it adds up", () => {\n  expect(chained(2)).toBe(0);\n});\n`,
    }),
  },
  {
    // Every class below finds every method of the class above. The plan asked for each (class, method) anew what hangs on the method alone, lowering listed all members of each
    // class to see that no primitive has them, and whatever named a class handed all members of the class above to the queue of units once more.
    name: "classes below one class that has as many methods, each handed to a function of its own",
    counted: "classes",
    size: 125,
    entry: "main.js",
    write: size => ({
      "main.js":
        `const replace = (0, eval)('(Base, size) => { for (let k = 0; k < size; k++) Base.prototype["m" + k] = () => 2; }');\nclass Base {\n` +
        lines(size, index => `  m${index}() { return 1; }`) +
        `}\n` +
        lines(
          size,
          index =>
            `class C${index} extends Base {}\nfunction r${index}(o) { let t = 0; for (let i = 0; i < 2; i++) t += o.m${index}(); return t; }\nconst o${index} = new C${index}();`,
        ) +
        `function all() {\n  let s = 0;\n` +
        lines(size, index => `  s += r${index}(o${index});`) +
        `  return s;\n}\nconsole.log(all());\nreplace(Base, ${size});\nconsole.log(all());\n`,
    }),
  },
  {
    // Each arrow function gives the promise of another module's namespace. The type of the list is the union of their types, and every member of it was held against every
    // other through three relations (the functions, the promises, the namespaces) to find that `x: 0` is not `x: 1`.
    name: "arrow functions in one list that each import a module of their own",
    counted: "modules",
    size: 250,
    entry: "main.ts",
    write: size => ({
      "main.ts":
        `const calls = [];\nfor (const load of [\n` +
        lines(size, index => `  () => import("./m${index}.ts"),`) +
        (size ? "" : "  // @ts-expect-error An element of an empty list is never, and never is not called.\n") +
        `]) calls.push(load());\nconst all = await Promise.all(calls);\nconsole.log(all.reduce((sum, module) => sum + module.x, 0));\n`,
      ...Object.fromEntries(upTo(size, index => [`m${index}.ts`, `export const x = ${index};\n`])),
    }),
  },
  {
    name: "stores to a variable that is declared int32, each of the value in front and one more",
    counted: "stores",
    size: 2000,
    entry: "main.ts",
    write: size => ({
      "main.ts": `function chain(seed: number): Bun.int32 {\n  let at: Bun.int32 = seed & 1;\n${lines(size, () => `  at = at + 1;`)}  return at;\n}\nconsole.log(chain(1));\n`,
    }),
  },
  {
    name: "stores to a variable that is declared int32, each behind a call in an arm",
    counted: "stores",
    size: 1000,
    entry: "main.ts",
    write: size => ({
      "main.ts": `function chain(seed: number, loud: boolean): Bun.int32 {\n  let at: Bun.int32 = seed & 1;\n${lines(size, () => `  if (loud) console.log(at);\n  at = at + 1;`)}  return at;\n}\nconsole.log(chain(1, false));\n`,
    }),
  },
  // Where the build verifies its code, each store whose barrier is left to a later one, and each allocation whose fence is, was asked forward by itself: all that stands behind it in the block, once for each.
  {
    name: "stores into one object and object literals in one list, in a build that verifies its code",
    counted: "stores and literals",
    size: 2500,
    entry: "main.js",
    flags: ["--aot-check=Validate"],
    write: size => ({
      "main.js":
        `class Pair { a = null; b = null; }\nfunction fill(o, c, d) {\n${lines(size, index => (index & 1 ? `o.a = c; o.b = d;` : `o.a = d; o.b = c;`))}return o; }\n` +
        `function list(c) { return [\n${lines(size, index => `{ v: c, i: ${index} },`)}]; }\n` +
        `const c = JSON.parse('{"k":1}'), d = JSON.parse('{"k":2}');\nconsole.log(fill(new Pair(), c, d).a.k, list(c).length);\n`,
    }),
  },
  // At the end of a block with two targets each owner that a later barrier covers at the first was looked for through the whole list of the second.
  {
    name: "objects with a store whose barrier is left to a later one over two hundred branches",
    counted: "objects",
    size: 1000,
    entry: "main.js",
    write: size => ({
      "main.js":
        `class Pair { a = null; b = null; }\nconst kept = [];\nfunction keep(o) { let w = 0; for (let i = 0; i < 2; i++) w = (w + i) | 0; kept.push(o); return w; }\n` +
        `function fill(c, s) {\nlet x = s | 0; for (let i = 0; i < 2; i++) x = (x + i) | 0;\n` +
        lines(size, index => `const o${index} = new Pair(); keep(o${index});`) +
        lines(size, index => `o${index}.a = c;`) +
        lines(200, index => `if ((x & 1) === 0) x = (x + ${index + 3}) | 0; else x = (x ^ ${index + 5}) | 0;`) +
        lines(size, index => `o${index}.b = c;`) +
        `return x; }\nconst c = JSON.parse('{"k":1}');\nconsole.log(fill(c, JSON.parse("7")), kept.length);\n`,
    }),
  },
  // Below each object that is laid where its cell is first needed, the first edge into a block counted all the edges into that block again.
  {
    name: "cases of one switch that each make an object for a way that leaves",
    counted: "cases",
    size: 4000,
    entry: "main.js",
    counts: ["BirthsLaidWhereCellsAreNeeded"],
    write: size => ({
      "main.js":
        `function run(kind, rare, kept) {\n  switch (kind) {\n` +
        lines(size, index => `    case ${index}: { const o = { kind, at: ${index} }; if (rare === ${index}) { kept.push(o); return ${index}; } break; }`) +
        `  }\n  return -1;\n}\nconst kept = []; let sum = 0;\nfor (let i = 0; i < 100; i++) sum += run(i, i & 1 ? i : -2, kept);\nconsole.log(sum, kept.length);\n`,
    }),
  },
  // The names that are read off a value were carried back to what meets in it one meeting a round, and all of them were sorted anew in each round.
  {
    name: "branches in a row that each hand another element on, two names read off what is left",
    counted: "branches",
    size: 2000,
    entry: "main.js",
    write: size => ({
      "main.js":
        `class Shape { constructor(w, h) { this.width = w; this.height = h; } }\nfunction pick(flags, other) {\n  let x = other[0];\n` +
        lines(size, index => `  if (flags[${index + 1}]) x = other[${index + 1}];`) +
        `  return x.width + x.height;\n}\nconsole.log(new Shape(1, 2).width + pick(JSON.parse("[]"), JSON.parse('[{"width":1,"height":2}]')));\n`,
    }),
  },
  // The same where each meeting has a name of its own: that was a cube. What is left is the list itself: each meeting has every name that is read behind it.
  ...[false, true].map(
    (inLoop): Shape => ({
      name: `branches in a row that each hand another element on, a name of its own read in front of each${inLoop ? ", in a loop" : ""}`,
      counted: "branches",
      size: 250,
      entry: "main.js",
      write: size => ({
        "main.js":
          `class Shape { constructor(w) {\n${lines(Math.max(size, 1), index => `    this.a${index} = w;`)}  } }\nfunction pick(flags, other) {\n  let x = other[0], s = 0;\n` +
          (inLoop ? `  for (let t = 0; t < 2; t++) {\n` : "") +
          lines(size, index => `  s += x.a${index}; if (flags[${index + 1}]) x = other[${index + 1}];`) +
          (inLoop ? `  }\n` : "") +
          `  return s;\n}\nconsole.log(new Shape(1).a0, pick(JSON.parse("[]"), JSON.parse('[{"a0":1}]')));\n`,
      }),
    }),
  ),
  // In a loop each walk over the own keys of a record went through all the orders in which the program makes records of its layout: to list where their makers stop, before it asked
  // for its two arms. Orders x walks: 2,000 of each took 7.1 G instructions for 4.1.
  {
    name: "records of one written type made in orders of their own, whose keys are counted in loops",
    counted: "orders, each with a function that counts keys in a loop",
    size: 500,
    entry: "main.ts",
    write: size => ({ "main.ts": recordsMadeInOrdersOfTheirOwn(size, "abcdefgh") }),
  },
  // A record of more fields than an arm takes gets no arm, and each walk found that out for every order anew: 2,000 of each took 42 G instructions, and 4.2 G since a worker keeps the answer.
  {
    name: "wide records of one written type made in orders of their own, whose keys are counted in loops",
    counted: "orders, each with a function that counts keys in a loop",
    size: 500,
    entry: "main.ts",
    write: size => ({ "main.ts": recordsMadeInOrdersOfTheirOwn(size, "abcdefghijklm") }),
  },
  // Each literal holds the names of the one before and one more, and passes for the type of every one before it. The text grows as the literals do, the program as the names
  // in all of them together: that number is the size. The plan of slots listed, for the type of each literal, every name of every literal that passes for it: 500 literals took 18.7 G instructions and 1.2 GB.
  {
    name: "literals that each spread the one before and add a name",
    counted: "names in all the literals together",
    size: 125000,
    entry: "main.js",
    write: size => {
      const literals = Math.floor(Math.sqrt(2 * size));
      return {
        "main.js": `const o0 = { a0: 0 };\n${lines(literals, index => `const o${index + 1} = { ...o${index}, a${index + 1}: ${index} };`)}console.log(o${literals}.a${literals});\n`,
      };
    },
  },
  // Which one layout has all the names that are read off a value is asked at each such value. Where each name is held by many layouts and all of them by none,
  // whoever goes through the holders of one name at every ask works by the layouts times the places that ask.
  {
    name: "functions that each read two names off a value of which nothing is known, each name held by as many classes and both by none",
    counted: "functions, and pairs of classes",
    size: 2000,
    entry: "main.js",
    write: size => ({
      "main.js":
        lines(
          size,
          index =>
            `class A${index} { constructor(v) { this.a = v; this.x${index} = v; } }\nclass B${index} { constructor(v) { this.b = v; this.y${index} = v; } }\nfunction f${index}(o) { return o.a + o.b + ${index}; }`,
        ) +
        `const made = [${upTo(size, index => `new A${index}(1), new B${index}(2)`).join(", ")}], unknown = JSON.parse("[]");\nlet s = 0;\nif (process.argv.length > 9) {\n` +
        lines(size, index => `  s += f${index}(unknown[${index}]);`) +
        `}\nconsole.log(made.length, s);\n`,
    }),
  },
  // Each loop whose turns may be written out asked every handler block of the function whether it reads a value of the loop: loops times handlers.
  {
    name: "short counted loops that each stand behind a try block in one function",
    counted: "loops",
    size: 2000,
    entry: "main.js",
    write: size => ({
      "main.js":
        `const unseen = x => [x][JSON.parse("0")];\nfunction run(v, g) {\n  let s = 0;\n` +
        lines(size, index => `  try { s += g(${index}); } catch { s -= 1; } for (let i = 0; i < 3; i++) s += v[i] + ${index};`) +
        "  return s;\n}\nconst g = unseen(x => x);\nconsole.log(run([1, 2, 3], g), run([4, 5, 6], g));\n",
    }),
  },
  // A read of a local that is stored in more than eight blocks went up through every join between it and the store, made a parameter at each, took it back and left four entries a join
  // behind: locals x joins, in time and in memory. 250 | 500 | 1,000 | 2,000 locals took 1,244 | 2,597 | 7,494 | 26,107 M instructions and 112 | 200 | 541 | 1,886 MB.
  {
    name: "locals of one function that are each stored on five ways, all read at the end",
    counted: "locals",
    size: 250,
    entry: "main.js",
    write: size => ({
      "main.js":
        `function run(n) {\n` +
        lines(size, index => `  let v${index} = ${index & 7}; ` + upTo(5, way => `if (n & ${1 << way}) v${index} = (v${index} + ${way + 1}) | 0;`).join(" ")) +
        `  let sum = 0;\n` +
        lines(size, index => `  sum = (sum + v${index}) | 0;`) +
        `  return sum;\n}\nconsole.log(run(JSON.parse("21")));\n`,
    }),
  },
  // The same locals, each stored on one way in each of twelve rounds: the arm that does not store looks for the store of the round before, past the joins of all the other locals. One time of
  // the last store a local would not do: the search goes on from a block that ended in front of that store. 125 | 250 | 500 | 1,000 locals took 1,333 | 2,653 | 7,224 | 23,915 M instructions, and 1,898 MB at the last.
  {
    name: "locals of one function that are each stored on one way in each of twelve rounds",
    counted: "locals",
    size: 250,
    entry: "main.js",
    write: size => ({
      "main.js":
        `function run(n) {\n` +
        lines(size, index => `  let v${index} = ${index & 7};`) +
        upTo(12, round => lines(size, index => `  if (n & ${1 << round % 5}) v${index} = (v${index} + ${round + 1}) | 0;`)).join("") +
        `  let sum = 0;\n` +
        lines(size, index => `  sum = (sum + v${index}) | 0;`) +
        `  return sum;\n}\nconsole.log(run(JSON.parse("21")));\n`,
    }),
  },
  // Each `new.target` in the value of a field asks whether the field is evaluated in the constructor. The answer was taken from a plan of the whole class that was made anew for each of them, twice:
  // 1,000 | 2,000 | 4,000 fields took Lower 969 | 3,732 | 14,730 M instructions.
  {
    name: "fields of one class that each read new.target",
    counted: "fields",
    size: 1000,
    entry: "main.js",
    write: size => ({
      "main.js": `class Shelf {\n` + lines(size, index => `  f${index} = new.target;`) + `}\nconsole.log(Object.keys(new Shelf()).length);\n`,
    }),
  },
  // Each read under the name that a for-in gave walked back to the step of its loop, through every block in between: 1,000 | 2,000 | 4,000 reads took 1.94 | 3.02 | 6.50 G instructions.
  {
    name: "reads under the name that a for-in gave, each behind a test of the name",
    counted: "reads",
    size: 2000,
    entry: "main.js",
    write: size => ({
      "main.js":
        `function pick(o) {\n  let x = 0;\n  for (const k in o) {\n` +
        lines(size, index => `    if (k === "a${index}") { x = o[k]; continue; }`) +
        `  }\n  return x;\n}\nconsole.log(pick(JSON.parse('{"a1":7}')));\n`,
    }),
  },
  // The same behind a call of a built-in: each call on the way went through all the records of calls of the function: 1,000 | 2,000 reads took 8.7 | 49.4 G instructions.
  {
    name: "reads under the name that a for-in gave, each behind a call of Object.hasOwn",
    counted: "reads",
    size: 2000,
    entry: "main.js",
    write: size => ({
      "main.js":
        lines(size, index => `const h${index} = { a${index}: 1 };`) +
        `function pick(o) {\n  let x = 0;\n  for (const k in o) {\n` +
        lines(size, index => `    if (Object.hasOwn(h${index}, k)) { x = o[k]; continue; }`) +
        `  }\n  return x;\n}\nconsole.log(pick(JSON.parse('{"a1":7}')));\n`,
    }),
  },
  // Each block of a merged namespace makes the object if it is not there yet: as many allocations of one layout as blocks, and the layout has a field for each name. The scan listed, for each
  // allocation, every field that it leaves empty, and sorted the list: 1,000 | 2,000 | 4,000 blocks took the scan 354 | 1,478 | 6,221 M instructions.
  // At twice this size the build still grows 2.35 times: each name stored into the object is listed for every allocation that may be that object, for the guesses of the walk.
  {
    name: "blocks of one merged namespace that each export a name",
    counted: "blocks",
    size: 500,
    entry: "main.ts",
    write: size => ({
      "tsconfig.json": withoutLibraryTypes,
      "main.ts":
        declaredConsole + `namespace Shelf { export const first = 1; }
` + lines(size, index => `namespace Shelf { export const a${index} = ${index}; }`) + `console.log(Shelf.first);
export {};
`,
    }),
  },
  // Each declaration held every base against every other, and each of their names against all names.
  {
    name: "declarations of one interface that each extend one base of as many names",
    counted: "declarations",
    size: 125,
    entry: "main.ts",
    write: size => ({
      "tsconfig.json": withoutLibraryTypes,
      "main.ts":
        `${declaredConsole}interface Base {\n${lines(Math.max(size, 1), index => `  b${index}: number;`)}}\n` +
        lines(Math.max(size, 1), index => `interface Registry extends Base { k${index}: number }`) +
        `const registry: Registry = JSON.parse('{"k0":1,"b0":2}');\nconsole.log(registry.k0 + registry.b0);\n`,
    }),
  },
  // Whether an interface inherits from its type arguments was asked of each base once for every way that leads to it.
  {
    name: "levels of two generic interfaces that each extend both of the level below",
    counted: "levels",
    size: 10,
    entry: "main.ts",
    write: size => ({
      "tsconfig.json": withoutLibraryTypes,
      "main.ts":
        `${declaredConsole}interface A0<T> { a: T }\ninterface B0<T> { b: T }\n` +
        lines(
          size,
          index =>
            `interface A${index + 1}<T> extends A${index}<T>, B${index}<T> { x${index + 1}: T }\n` +
            `interface B${index + 1}<T> extends A${index}<T>, B${index}<T> { y${index + 1}: T }`,
        ) +
        `const top: A${size}<number> = JSON.parse('{"a":1}');\nconsole.log(top.a);\n`,
    }),
  },
  // The same question as two rows up, asked anew in each file.
  {
    name: "files that each declare one global interface again, which extends one base of as many names",
    counted: "files",
    size: 60,
    entry: "main.ts",
    write: size =>
      filesThatDeclareAGlobalInterface(
        size,
        index => `interface Registry extends Base { k${index}: number }`,
        `interface Base {\n${lines(Math.max(size, 1), index => `  b${index}: number;`)}}\ninterface Registry extends Base { first: number }`,
        `const registry: Registry = JSON.parse('{"first":1,"b0":2}');\nconsole.log(registry.first + registry.b0, sum);\n`,
      ),
  },
  // In each file, each name of the whole interface went through all the declarations to learn whether it stands in one of them.
  {
    name: "files that each declare a name of their own of one global interface with an index signature",
    counted: "files",
    size: 500,
    entry: "main.ts",
    write: size =>
      filesThatDeclareAGlobalInterface(
        size,
        index => `interface Held { k${index}: string }`,
        `interface Held { [name: string]: string }`,
        `const held: Held = JSON.parse('{"k0":"a"}');\nconsole.log(held.k0, sum);\n`,
      ),
  },
  // In each file, the type parameters of all the declarations were held against each other.
  {
    name: "files that each declare one generic global interface again",
    counted: "files",
    size: 500,
    entry: "main.ts",
    write: size =>
      filesThatDeclareAGlobalInterface(
        size,
        index => `interface Matchers<R, T = unknown> { k${index}(expected: T): R }`,
        `interface Matchers<R, T = unknown> { first(expected: T): R }`,
        `const matchers: Matchers<number> = JSON.parse("{}");\nconsole.log(typeof matchers, sum);\n`,
      ),
  },
  // The fields that a constructor stores first of all are born with their stores. Each store looked for its field among all that were still empty, asking each private one for its name, and took it
  // out of the list; each field looked for its name among those in front of it, and for its store among all stores. The order of the stores is the reverse of the fields': the longest way.
  // 1,000 | 2,000 | 4,000 fields took Lower 152 | 455 | 1,650 M instructions. And each reference to a private name went through all members of the class, twice, in the binder.
  // At larger sizes the build still bends: the checker goes through the members for the type of each field, and the walk through the order of the keys for each store.
  {
    name: "private fields of one class that its constructor stores in the reverse order",
    counted: "fields",
    size: 750,
    entry: "main.js",
    write: size => ({
      "main.js":
        `class Shelf {\n  #first = 0;\n` +
        lines(size, index => `  #x${index};`) +
        `  constructor(n) {\n` +
        lines(size, index => `    this.#x${size - 1 - index} = n;`) +
        `  }\n  get() {\n    return this.#first${size ? ` + this.#x0 + this.#x${size - 1}` : ""};\n  }\n}\nconsole.log(new Shelf(1).get());\n`,
    }),
  },
  // Each call spreads a value of which nothing is known, in one loop: the ways part on whether it is a list as made and meet behind the call. Two operations are walked once for each way,
  // and no way parts ways again: the build grows as the calls do.
  {
    name: "calls in one loop that each spread a value of which nothing is known",
    counted: "calls",
    size: 1000,
    entry: "main.js",
    write: size => ({
      "main.js":
        `function f(a, b) { return a + b; }\nconst lists = JSON.parse("[[1,2],[3,4]]");\nlet s = 0;\nfor (let i = 0; i < 10; i++) {\n` +
        lines(size, index => `  s += f(...lists[(i + ${index}) & 1]);`) +
        `}\nconsole.log(s);\n`,
    }),
  },
  // Each test asks whether a lookup under its key stands behind it: none does, and there are as many lookups as tests. The list of lookups is sorted by the key and asked once a test.
  {
    name: "tests for keys in a loop that no lookup behind them takes",
    counted: "tests",
    size: 4000,
    entry: "main.js",
    write: size => ({
      "main.js":
        `const m = new Map(); m.set("a", 1);\nconst keys = JSON.parse('["a", "b"]'); let n = 0;\nfor (let i = 0; i < 2; i++) {\n` +
        lines(size, index => `  if (m.has(keys[${index} & 1])) n++;`) +
        lines(size, index => `  n += m.get(${index}) ?? 0;`) +
        `}\nconsole.log(n);\n`,
    }),
  },
  {
    name: "elements of a list of which nothing is declared, read and summed in one block of a loop",
    counted: "reads",
    size: 4000,
    entry: "main.ts",
    write: size => ({
      "tsconfig.json": withoutLibraryTypes,
      "main.ts":
        declaredConsole +
        `const key: string = JSON.parse('"go"');\n` +
        `const table: Record<string, (c: any) => unknown> = {\n  go(c: any): unknown {\n    let s: any = 0;\n    for (let i = 0; i + ${size} <= c.length; i++) s = 0${upTo(size, index => ` + c[i + ${index}]`).join("")};\n    return s;\n  },\n};\n` +
        `const a: number[] = [];\nfor (let k = 0; k < ${size} + 2; k++) a.push(k & 7);\nconsole.log(String(table[key]!(a)));\n`,
    }),
  },
  // The plan of guards asks of each parameter whether the loops that read it get a front: one walk of the body answers for all of them.
  {
    name: "parameters of one function that a loop each reads as a list of numbers",
    counted: "parameters",
    size: 1000,
    entry: "main.cjs",
    write: size => ({
      "main.cjs":
        `"use strict";\nconst key = JSON.parse('"go"');\nconst table = { go(${upTo(size, index => `p${index}`).join(", ")}) {\n  let h = 7;\n` +
        lines(size, index => `  for (let i = 0; i < p${index}.length; i++) h = (h * 31 + p${index}[i]) | 0;`) +
        `  return h;\n} };\nconsole.log(table[key](...Array(${size}).fill(JSON.parse("[1,2]"))));\n`,
    }),
  },
  {
    name: "parameters of one function that a loop each compares with a character",
    counted: "parameters",
    size: 1000,
    entry: "main.cjs",
    write: size => ({
      "main.cjs":
        `"use strict";\nconst key = JSON.parse('"go"');\nconst table = { go(${upTo(size, index => `p${index}`).join(", ")}) {\n  let n = 0;\n` +
        lines(size, index => `  for (let i = 0; i < p${index}.length; i++) if (p${index}[i] === ",") n++;`) +
        `  return n;\n} };\nconsole.log(table[key](...Array(${size}).fill(JSON.parse('"a,b"'))));\n`,
    }),
  },
  // What a handler outside a loop reads is boxed on the edges into that handler: found by the handler, not by a walk over all that was ever listed.
  {
    name: "loops of one function, each left by a catch that reads its counter",
    counted: "loops",
    size: 1000,
    entry: "main.cjs",
    write: size => ({
      "main.cjs":
        `"use strict";\nconst key = JSON.parse('"go"');\nconst table = { go(s) {\n  let h = 7;\n` +
        lines(size, index => `  for (let i = 0; i < s.length; i++) { try { h = (h * 31 + s[i] * ${index + 1}) | 0; } catch (e) { return i; } }`) +
        `  return h;\n} };\nconsole.log(table[key](JSON.parse("[1,2]")));\n`,
    }),
  },
  // The look at what a copy of a callee reads off the lists that it is handed read the callee's own callees too, however long they are: calls times lines.
  {
    name: "calls of a small helper in one turn, and as many lines in the helper that it calls",
    counted: "calls",
    size: 1000,
    entry: "main.js",
    write: size => ({
      "main.js":
        `function big(a, i) {\n  let x = 0;\n` +
        lines(size, index => `  x = x + a[i] * ${(index % 9) + 1};`) +
        `  return x;\n}\nfunction take(a, i) { return big(a, i); }\nfunction count() {\n  let s = 0;\n  for (let i = 0; i < held.length; i++) {\n` +
        lines(size, () => `    s = s + take(held, i);`) +
        `  }\n  return s;\n}\nglobalThis.sink?.(count, big, take);\nconst held = JSON.parse("[1,2,3]");\nconsole.log(count(), big(held, 1));\n`,
    }),
  },
  // A proven read that might stand in front of a loop asked every member of the receiver's family for its field: heirs times loops.
  {
    name: "heirs of one class, and twice as many small loops that read a field of the base off a list of them",
    counted: "heirs",
    size: 1000,
    entry: "main.cjs",
    write: size => ({
      "main.cjs":
        `"use strict";\nclass B { constructor(k) { this.k = k; } }\n` +
        lines(size, index => `class H${index} extends B { constructor() { super(${index}); } }`) +
        `const all = [${upTo(size, index => `new H${index}()`).join(", ")}];\nfunction f(n) { let s = 0;\n` +
        lines(size * 2, index => `for (let i = 0; i < n; i++) s += all[(i + ${index}) & 7].k;`) +
        `return s; }\nconsole.log(f(2));\n`,
    }),
  },
  // Each inner question asks for the truth of one value, and none of the blocks that asked for it earlier stands above the next. The look for the nearest one above went back over all of them, once a question.
  {
    name: "questions for the truth of one value in arms that stand beside one another",
    counted: "questions",
    size: 8000,
    entry: "main.js",
    write: size => ({
      "main.js":
        `function many(x, c, d) {\n  let a = 0;\n` +
        lines(size, index => `  if (c[${index & 7}]) { if (d) a++; if (x) a += 2; }`) +
        `  return a;\n}\nconst c = JSON.parse("[1, 0, 1, 0, 1, 0, 1, 0]");\nconsole.log(many(c[0], c, c[1]), many(c[1], c, c[0]));\n`,
    }),
  },
  {
    // Twelve instantiations of one type stand on one way through the fields, each with the union as an argument. Whoever asked which of them is the greater measured the union anew each time, and looked each member up among all that it had met.
    name: "members of a union that twelve instantiations of one type, written out in a row of interfaces, have as an argument",
    counted: "members",
    size: 4000,
    entry: "main.ts",
    write: size => ({
      "main.ts":
        `type Keys = ${upTo(Math.max(size, 1), index => `"k${index}"`).join(" | ")};\ntype Box<K, V> = { id: number; key?: K; value?: V };\n` +
        lines(11, index => `interface I${index + 1} { to: Box<Keys, ${index < 10 ? `I${index + 2}` : "number"}> }`) +
        `const given: Box<Keys, I1> = JSON.parse('{"id":1,"value":{"to":{"id":2}}}');\nfunction read(b: Box<Keys, I1>): number { return b.id + (b.value?.to.id ?? 0); }\nconsole.log(read(given));\nexport {};\n`,
    }),
  },
  {
    // The same where each instantiation is computed from the one before: nothing written out stands between them.
    name: "members of a union that twelve instantiations of one mapped type, each computed from the one before, have as an argument",
    counted: "members",
    size: 4000,
    entry: "main.ts",
    write: size => ({
      "main.ts":
        `type Keys = ${upTo(Math.max(size, 1), index => `"k${index}"`).join(" | ")};\n` +
        lines(12, index => `interface R${index + 1} { n${index + 1}: number;${index < 11 ? ` d${index + 1}: R${index + 2};` : ""} }`) +
        `type Deep<T, K> = T extends object ? { readonly [P in keyof T]: Deep<T[P], K> } : T;\n` +
        `const given: Deep<R1, Keys> = JSON.parse('{"n1":1,"d1":{"n2":2}}');\nfunction read(v: Deep<R1, Keys>): number { return v.n1 + v.d1.n2; }\nconsole.log(read(given));\nexport {};\n`,
    }),
  },
  // A type of as many functions arrives at as many reads. Whether a unit may mention the functions of a type is asked once for the type, and a body names them once.
  {
    name: "calls that each hand a literal of their own to a function that reads as many members in a loop",
    counted: "calls",
    size: 250,
    entry: "main.js",
    write: size => ({
      "main.js":
        `function run(o, n) { let s = 0; for (let i = 0; i < n; i++) {\n` +
        lines(size, index => `s = (o.handler(s + ${index}) + o.bias) | 0;`) +
        `} return s; }\nglobalThis.kept = run;\nlet t = 0;\n` +
        lines(size, index => `t += run({ handler: x => x + ${index}, bias: ${index} }, 2);`) +
        `console.log(t);\n`,
    }),
  },
  // Whether a loop compares the elements of a constant of the file with characters is read off the loop's text once a loop, not once a read.
  {
    name: "comparisons of an element of a constant of the file with a character, all in one loop",
    counted: "comparisons",
    size: 2000,
    entry: "main.js",
    write: size => ({
      "main.js":
        `function count() {\n  let c = 0;\n  for (let i = 0; i < held.length; i++) {\n` +
        lines(size, () => `    c = c + +(held[i] === "a");`) +
        `  }\n  return c;\n}\nconst held = JSON.parse('"abca"');\nconsole.log(count());\n`,
    }),
  },
  // An element access under a union of keys asks the checker for the property under each key. What hangs on the two types alone is kept under them.
  {
    name: "functions that each loop over what one record holds under a parameter typed by the record's keys",
    counted: "functions, and fields of the record",
    size: 1000,
    entry: "main.ts",
    write: size => ({
      "main.ts":
        `type Held = { ${upTo(size, index => `f${index}: Set<number>;`).join(" ")} };\ntype Names = keyof Held;\n` +
        `const held: Held = { ${upTo(size, index => `f${index}: new Set([${index}])`).join(", ")} };\nlet sum = 0;\n` +
        lines(size, index => `function e${index}(name: Names): void { for (const one of held[name]) sum += one; }`) +
        `const all = [${upTo(size, index => `e${index}`).join(", ")}];\nconst names: Names[] = JSON.parse('["f0","f1"]');\n` +
        `for (let i = 0; i < all.length; i++) all[i]!(names[i & 1]!);\nconsole.log(sum);\n`,
    }),
  },
  // The row is asked once and each store in kind is followed by a place from which the rest may run as written: the rest is written once, not once for each store.
  {
    name: "stores into a row that the turn of a loop finds",
    counted: "stores",
    size: 800,
    entry: "main.js",
    write: size => ({
      "main.js":
        `"use strict";\nfunction made(count, width) { const grid = []; for (let r = 0; r < count; r++) { const row = []; for (let j = 0; j < width; j++) row.push((r * 7 + j * 3) % 11 + 0.25); grid.push(row); } return grid; }\n` +
        `function scaled(rows, s) {\n  for (let k = 0; k < rows.length; k++) {\n` +
        lines(size, index => `    rows[k][${index}] = rows[k][${index}] * s;`) +
        `  }\n}\nconst grid = made(4, ${Math.max(size, 1)});\nscaled(grid, 0.5);\nlet sum = 0;\nfor (const row of grid) for (const x of row) sum += x;\nconsole.log(sum);\n`,
    }),
  },
  // Whether the block stores into the row behind a read is looked up, not looked for anew at each read.
  {
    name: "reads of a row that the turn of a loop finds and does not store into",
    counted: "reads",
    size: 2000,
    entry: "main.ts",
    write: size => ({
      "main.ts":
        `function sum(V: number[][], out: number[]): number {\n  let s = 0;\n  for (let k = 0; k < V.length; k++) {\n    out[k] = k;\n` +
        lines(size, index => `    s = s + V[k][${index % 3}];`) +
        `  }\n  return s;\n}\nconst V: number[][] = JSON.parse("[[1.5,2,3],[4,5,6.5]]");\nconsole.log(sum(V, []));\nexport {};\n`,
    }),
  },
  // A stretch ends at its first store into the row, so nothing that was read in front is joined again at each later store.
  ...(["in statements", "in one expression", "beside an object made in the turn"] as const).map(
    (how): Shape => ({
      name: `elements of a row that the turn of a loop finds are all read and then all stored ${how}`,
      counted: "elements",
      size: 400,
      entry: "main.js",
      write: size => {
        const width = Math.max(size, 1);
        const factor = how === "beside an object made in the turn" ? "pair.a" : "s";
        const stored = (index: number) => (how === "beside an object made in the turn" ? `v${index} + pair.b` : `v${index}`);
        return {
          "main.js":
            `"use strict";\nfunction made(count, width) { const grid = []; for (let r = 0; r < count; r++) { const row = []; for (let j = 0; j < width; j++) row.push((r * 7 + j * 3) % 11 + 0.25); grid.push(row); } return grid; }\n` +
            `function take(x) { return x + 1; }\nfunction turned(rows, s) {\n  let last = 0;\n  for (let k = 0; k < rows.length; k++) {\n    const pair = { a: s + k, b: s - k };\n` +
            lines(size, index => `    const v${index} = rows[k][${index}] * ${factor};`) +
            (how === "in one expression"
              ? `    last += take((${upTo(size, index => `rows[k][${index}] = ${stored(index)}`).join(", ") || "0"}));\n`
              : lines(size, index => `    rows[k][${index}] = ${stored(index)};`)) +
            `    last += pair.a;\n  }\n  return last;\n}\nconst grid = made(4, ${width});\nlet got = 0;\nfor (let t = 0; t < 4; t++) got += turned(grid, t & 1 ? 2 : 0.5);\n` +
            `let sum = 0;\nfor (const row of grid) for (const x of row) sum += x;\nconsole.log(Math.floor(sum * 1000) % 1000003, Math.floor(got * 1000) % 1000003);\n`,
        };
      },
    }),
  ),
  // Each element is a phi that lives until its last read, and a phi that is to share its spill slot asked whether it is still read on some way on: a search from all its reads back to its definition, once a value.
  {
    name: "elements of a row held in a variable are read and stored one by one and all read again twice behind",
    counted: "elements",
    size: 400,
    entry: "main.js",
    counts: ["BlocksReachedBySearchesForWaysToReads"],
    write: size => ({
      "main.js":
        `"use strict";\nfunction made(count, width) { const grid = []; for (let r = 0; r < count; r++) { const row = []; for (let j = 0; j < width; j++) row.push((r * 7 + j * 3) % 11 + 0.25); grid.push(row); } return grid; }\n` +
        `function turned(rows, s) {\n  let first = 0, second = 0;\n  for (let k = 0; k < rows.length; k++) {\n    const row = rows[k];\n` +
        lines(size, index => `    const v${index} = row[${index}];\n    row[${index}] = v${index} * s;`) +
        lines(size, index => `    first += v${index};`) +
        lines(size, index => `    second -= v${index};`) +
        `  }\n  return first + first + second;\n}\nconst grid = made(4, ${Math.max(size, 1)});\nlet got = 0;\nfor (let t = 0; t < 4; t++) got += turned(grid, t & 1 ? 2 : 0.5);\n` +
        `console.log(Math.floor(got * 1000) % 1000003);\n`,
    }),
  },
  // Each read asked who its users are by going through its block up to the last of them; that is asked once a block now. The checker walked from each `rows[k][j]` back over every store in front of it;
  // nothing can match a reference under a key that is stored again, so it does not walk for one.
  {
    name: "elements of a row that the turn of a loop finds are read and stored one by one and all read again behind",
    counted: "elements",
    size: 400,
    entry: "main.js",
    write: size => ({
      "main.js":
        `"use strict";\nfunction made(count, width) { const grid = []; for (let r = 0; r < count; r++) { const row = []; for (let j = 0; j < width; j++) row.push((r * 7 + j * 3) % 11 + 0.25); grid.push(row); } return grid; }\n` +
        `function turned(rows, s) {\n  let last = 0;\n  for (let k = 0; k < rows.length; k++) {\n` +
        lines(size, index => `    const v${index} = rows[k][${index}];\n    rows[k][${index}] = v${index} * s;`) +
        lines(size, index => `    last += v${index};`) +
        `  }\n  return last;\n}\nconst grid = made(4, ${Math.max(size, 1)});\nlet got = 0;\nfor (let t = 0; t < 4; t++) got += turned(grid, t & 1 ? 2 : 0.5);\n` +
        `let sum = 0;\nfor (const row of grid) for (const x of row) sum += x;\nconsole.log(Math.floor(sum * 1000) % 1000003, Math.floor(got * 1000) % 1000003);\n`,
    }),
  },
  // The checker leaps over the stores that leave a reference alone by an index that files each under its first name. An element was filed under no name, whatever its key: `row[3] = ..` stood in the way of `row[7]`.
  {
    name: "elements of a typed row under written keys are read and stored one by one",
    counted: "elements",
    size: 800,
    entry: "main.ts",
    write: size => ({
      "main.ts":
        `function made(count: number, width: number): number[][] { const grid: number[][] = []; for (let r = 0; r < count; r++) { const row: number[] = []; for (let j = 0; j < width; j++) row.push((r * 7 + j * 3) % 11 + 0.25); grid.push(row); } return grid; }\n` +
        `function turned(rows: number[][], s: number): number {\n  let last = 0;\n  for (let k = 0; k < rows.length; k++) {\n    const row = rows[k];\n` +
        lines(size, index => `    const v${index} = row[${index}];\n    row[${index}] = v${index} * s;`) +
        lines(size, index => `    last += v${index};`) +
        `  }\n  return last;\n}\nconst grid = made(4, ${Math.max(size, 1)});\nlet got = 0;\nfor (let t = 0; t < 4; t++) got += turned(grid, t & 1 ? 2 : 0.5);\n` +
        `console.log(Math.floor(got * 1000) % 1000003);\n`,
    }),
  },
  // A loop that reckons with elements is built twice whatever its size. What the walk asks at a statement of such a loop it may not ask of every other statement of the loop.
  {
    name: "one loop stores into the elements of a list handed in under written keys",
    counted: "statements",
    size: 250,
    entry: "main.cjs",
    counts: ["StoresPutBackWhereTurnsBeginAgain"],
    write: size => ({
      "main.cjs":
        `"use strict";\nconst V = JSON.parse("[" + Array.from({ length: 64 }, (_, i) => i & 63).join() + "]");\nconst O = JSON.parse("[" + Array.from({ length: ${size + 1} }, () => 0).join() + "]");\n` +
        `function go(d, o) {\n  for (let i = 0; i < d.length; i++) {\n` +
        lines(size, index => `    o[${index}] = o[${index}] * 0.5 + d[i] * 3;`) +
        `  }\n  return o[0];\n}\nlet all = 0;\nfor (let t = 0; t < 3; t++) all = (all + go(V, O)) % 1000003;\nconsole.log(Math.floor(all));\n`,
    }),
  },
  {
    name: "one loop adds an element of a list handed in to each field of a written object",
    counted: "statements",
    size: 250,
    entry: "main.cjs",
    write: size => ({
      "main.cjs":
        `"use strict";\nconst V = JSON.parse("[" + Array.from({ length: 64 }, (_, i) => i & 63).join() + "]");\n` +
        `function go(d) {\n  const o = { x: 0${upTo(size, index => `, x${index}: 0`).join("")} };\n  for (let i = 0; i < d.length; i++) {\n    o.x = (o.x + d[i] * 3) | 0;\n` +
        lines(size, index => `    o.x${index} = (o.x${index} + d[i] * 3) | 0;`) +
        `  }\n  return o.x;\n}\nlet all = 0;\nfor (let t = 0; t < 3; t++) all = (all + go(V)) % 1000003;\nconsole.log(all);\n`,
    }),
  },
  {
    name: "one loop adds an element of a list handed in to each variable that a closure captures",
    counted: "statements",
    size: 250,
    entry: "main.cjs",
    write: size => ({
      "main.cjs":
        `"use strict";\nconst V = JSON.parse("[" + Array.from({ length: 64 }, (_, i) => i & 63).join() + "]");\n` +
        `function go(d) {\n  let v = 0${upTo(size, index => `, v${index} = 0`).join("")};\n  const sum = () => v${upTo(size, index => ` + v${index}`).join("")};\n  for (let i = 0; i < d.length; i++) {\n    v = (v + d[i] * 3) | 0;\n` +
        lines(size, index => `    v${index} = (v${index} + d[i] * 3) | 0;`) +
        `  }\n  return sum();\n}\nlet all = 0;\nfor (let t = 0; t < 3; t++) all = (all + go(V)) % 1000003;\nconsole.log(all);\n`,
    }),
  },
  {
    name: "one loop reckons with an element of a list handed in again and again",
    counted: "statements",
    size: 250,
    entry: "main.cjs",
    write: size => ({
      "main.cjs":
        `"use strict";\nconst V = JSON.parse("[" + Array.from({ length: 64 }, (_, i) => i & 63).join() + "]");\n` +
        `function go(d) {\n  let h = 7;\n  for (let i = 0; i < d.length; i++) {\n    h = (h * 3 ^ d[i]) & 65535;\n` +
        lines(size, () => `    h = (h * 3 ^ d[i]) & 65535;`) +
        `  }\n  return h;\n}\nlet all = 0;\nfor (let t = 0; t < 3; t++) all = (all + go(V)) % 1000003;\nconsole.log(all);\n`,
    }),
  },
  // Every way that begins a turn again wrote out the put-backs of all the stores in front of it. Each store has one block, which goes on to the block of the store before it.
  {
    name: "a helper that stores three doubles into the list handed in is called again and again in one turn",
    counted: "calls",
    size: 8,
    entry: "main.js",
    counts: ["StoresPutBackWhereTurnsBeginAgain"],
    write: size => ({
      "main.js":
        `function acc(out, a) { out[0] = out[0] + a[0]; out[1] = out[1] + a[1]; out[2] = out[2] + a[2]; return out; }\nvar o = [0.5, 1.75, 3.5], p = [1.5, 2.5, 3.5];\n` +
        `function f(t) {\n  o[0] = 0.5; o[1] = 1.75; o[2] = 3.5;\n  for (var i = 0; i < 50; i++) {\n` +
        lines(size, () => `    acc(o, p);`) +
        `  }\n  return o[0] + o[2];\n}\nvar sum = 0;\nfor (var t = 0; t < 4; t++) sum += f(t);\nconsole.log(sum);\n`,
    }),
  },
  // A chain of two names has a table of its own in that index; it knew dots alone, and `this.row[5] = ..` was filed under `row`.
  {
    name: "elements of a list in a field of this under written keys are read and stored one by one",
    counted: "elements",
    size: 800,
    entry: "main.ts",
    write: size => ({
      "main.ts":
        `class Grid {\n  row: number[] = [];\n  constructor(count: number) { for (let j = 0; j < count; j++) this.row.push((j * 3) % 11 + 0.25); }\n  turned(s: number): number {\n    let last = 0;\n` +
        lines(size, index => `    const v${index} = this.row[${index}];\n    this.row[${index}] = v${index} * s;`) +
        lines(size, index => `    last += v${index};`) +
        `    return last;\n  }\n}\nconst grid = new Grid(${Math.max(size, 1)});\nlet got = 0;\nfor (let t = 0; t < 4; t++) got += grid.turned(t & 1 ? 2 : 0.5);\n` +
        `console.log(Math.floor(got * 1000) % 1000003);\n`,
    }),
  },
  // That table filed a chain under its first two names: stores that share them stood in each other's way. It files the whole path, and a variable that is never stored again is a step of it.
  ...[
    { told: "in a field of a field of this", head: "", row: "this.inner.row" },
    { told: "under a parameter that is never stored again", head: "    const rows = [this.inner.row];\n", row: "rows[k]" },
  ].map(
    ({ told, head, row }): Shape => ({
      name: `elements of a list ${told} under written keys are read and stored one by one`,
      counted: "elements",
      size: 800,
      entry: "main.ts",
      write: size => ({
        "main.ts":
          `class Inner { row: number[] = []; }\nclass Grid {\n  inner = new Inner();\n  constructor(count: number) { for (let j = 0; j < count; j++) this.inner.row.push((j * 3) % 11 + 0.25); }\n  turned(s: number, k: number): number {\n    let last = 0;\n${head}` +
          lines(size, index => `    const v${index} = ${row}[${index}];\n    ${row}[${index}] = v${index} * s;`) +
          lines(size, index => `    last += v${index};`) +
          `    return last;\n  }\n}\nconst grid = new Grid(${Math.max(size, 1)});\nlet got = 0;\nfor (let t = 0; t < 4; t++) got += grid.turned(t & 1 ? 2 : 0.5, 0);\n` +
          `console.log(Math.floor(got * 1000) % 1000003);\n`,
      }),
    }),
  ),
  // Whatever is said or seen of what a key finds in such a literal names all of its methods: each is gone through once.
  {
    name: "methods of one literal that is read under a key in a loop",
    counted: "methods",
    size: 2000,
    entry: "main.js",
    write: size => ({
      "main.js":
        `const table = {\n` +
        lines(Math.max(size, 1), index => `  m${index}(x) { return (x + ${index}) | 0; },`) +
        `};\nconst key = JSON.parse('"m0"');\nlet sum = 0;\nfor (let i = 0; i < 9; i++) sum = (sum + table[key](i)) | 0;\nconsole.log(sum);\n`,
    }),
  },
  {
    // Both sizes lie behind the step at 4,095 names.
    name: "stores of one of two values on this under more names than an order is kept in line for",
    counted: "stores",
    size: 8000,
    entry: "main.js",
    write: constructorThatStoresOneOfTwoValues,
  },
  // What stands at a place of a written list is laid into a node when a read under a written index asks for it: once a family and a place, however many lists meet and whoever reads.
  {
    name: "written pairs that all meet in one list and are read under written indexes",
    counted: "pairs",
    size: 2000,
    entry: "main.js",
    write: size => ({
      "main.js":
        `class Holder { constructor(name) { this.name = name; } }\nconst all = [];\n` +
        lines(size, index => `all.push([new Holder("h${index}"), ${index} * 0.5]);`) +
        `let sum = 0;\nfor (const pair of all) sum += pair[1] + pair[0].name.length;\nconsole.log(sum);\n`,
    }),
  },
  {
    name: "written pairs that all meet in one list, and as many functions that read them under written indexes",
    counted: "pairs, and functions",
    size: 2000,
    entry: "main.js",
    write: size => ({
      "main.js":
        `class Holder { constructor(name) { this.name = name; } }\nconst all = [];\n` +
        lines(size, index => `all.push([new Holder("h${index}"), ${index} * 0.5]);`) +
        lines(size, index => `function r${index}(pair) { return pair[1] + pair[0].name.length + ${index}; }`) +
        `let sum = 0;\n` +
        lines(size, index => `sum += r${index}(all[${index}]);`) +
        `console.log(sum);\n`,
    }),
  },
  {
    name: "written pairs that are each read under written indexes where they are made and then meet in one list",
    counted: "pairs",
    size: 2000,
    entry: "main.js",
    write: size => ({
      "main.js":
        `class Holder { constructor(name) { this.name = name; } }\nconst all = [];\nlet sum = 0;\n` +
        lines(size, index => `function m${index}() { const pair = [new Holder("h${index}"), ${index} * 0.5]; sum += pair[1] + pair[0].name.length; all.push(pair); }\nm${index}();`) +
        `for (const pair of all) sum += pair[1] + pair[0].name.length;\nconsole.log(sum);\n`,
    }),
  },
  {
    name: "pairs of reads of a static field in one turn of a loop with a call behind each pair",
    counted: "pairs",
    size: 350,
    entry: "main.js",
    write: size => ({
      "main.js":
        `class Tally { static count = 1; }\nlet nudged = 0;\nlet nudge = () => { nudged++; };\nfunction raise(turns) {\n  let sum = 0;\n  for (let i = 0; i < turns; i++) {\n` +
        lines(size, () => `    sum += Tally.count + Tally.count; nudge();`) +
        `    Tally.count += 1;\n  }\n  return sum;\n}\nconsole.log(raise(3), nudged);\n`,
    }),
  },
  {
    name: "reads of two static fields that take turns in one turn of a loop",
    counted: "steps",
    size: 350,
    entry: "main.js",
    write: size => ({
      "main.js":
        `class Pair { static left = 1; static right = 2; }\nfunction weave(turns) {\n  let sum = 0;\n  for (let i = 0; i < turns; i++) {\n` +
        lines(size, () => `    sum += Pair.left + Pair.left + Pair.right;`) +
        `    Pair.left += 1; Pair.right += 2;\n  }\n  return sum;\n}\nconsole.log(weave(3));\n`,
    }),
  },
  {
    name: "a static field that is raised again and again in one turn of a loop",
    counted: "steps",
    size: 350,
    entry: "main.js",
    write: size => ({
      "main.js":
        `class Tally { static count = 1; }\nfunction raise(turns) {\n  let sum = 0;\n  for (let i = 0; i < turns; i++) {\n` +
        lines(size, index => `    Tally.count += ${index & 3}; sum += Tally.count & 7;`) +
        `  }\n  return sum;\n}\nconsole.log(raise(3), Tally.count);\n`,
    }),
  },
  {
    name: "reads of one static field with operators alone between them in one turn of a loop",
    counted: "reads",
    size: 700,
    entry: "main.js",
    write: size => ({
      "main.js":
        `class Tally { static count = 1; }\nfunction total(turns) {\n  let sum = 0;\n  for (let i = 0; i < turns; i++) {\n` +
        lines(size, () => `    sum = (sum + Tally.count) | 0;`) +
        `    Tally.count += 1;\n  }\n  return sum;\n}\nconsole.log(total(3), Tally.count);\n`,
    }),
  },
  {
    name: "a read and a store of a static field with operators between them in one turn of a loop",
    counted: "operators",
    size: 700,
    entry: "main.js",
    write: size => ({
      "main.js":
        `class Tally { static count = 1; }\nfunction total(turns) {\n  let x = 1;\n  for (let i = 0; i < turns; i++) {\n    const before = Tally.count;\n` +
        lines(size, index => `    x = (x * 3 + ${index & 7}) | 0;`) +
        `    Tally.count = before + (x & 3);\n  }\n  return x;\n}\nconsole.log(total(3), Tally.count);\n`,
    }),
  },
  {
    name: "a read and a store of a static field with reads of a variable of the file between them in one turn of a loop",
    counted: "reads",
    size: 700,
    entry: "main.js",
    write: size => ({
      "main.js":
        `class Tally { static count = 1; }\nlet other = 2;\nfunction total(turns) {\n  let x = 1;\n  for (let i = 0; i < turns; i++) {\n    const before = Tally.count;\n` +
        lines(size, () => `    x = (x + other) | 0;`) +
        `    Tally.count = before + (x & 3);\n  }\n  return x;\n}\nconsole.log(total(3), Tally.count);\nother = 3;\nconsole.log(total(3), Tally.count);\n`,
    }),
  },
  {
    name: "stores into one static field in one turn of a loop",
    counted: "stores",
    size: 700,
    entry: "main.js",
    write: size => ({
      "main.js":
        `class Tally { static count = 1; }\nfunction total(turns) {\n  for (let i = 0; i < turns; i++) {\n` +
        lines(size, index => `    Tally.count = i + ${index};`) +
        `  }\n  return Tally.count;\n}\nconsole.log(total(3));\n`,
    }),
  },
  {
    name: "reads of a static field and of a variable of the file that take turns in one turn of a loop",
    counted: "steps",
    size: 700,
    entry: "main.js",
    write: size => ({
      "main.js":
        `class Tally { static count = 1; }\nlet other = 2;\nfunction total(turns) {\n  let sum = 0;\n  for (let i = 0; i < turns; i++) {\n` +
        lines(size, () => `    sum = (sum + Tally.count + other) | 0;`) +
        `    Tally.count += 1;\n  }\n  return sum;\n}\nconsole.log(total(3), Tally.count);\n`,
    }),
  },
  {
    name: "a static field that is compared again and again in one turn of a loop",
    counted: "steps",
    size: 700,
    entry: "main.js",
    write: size => ({
      "main.js":
        `class Tally { static count = 1; }\nfunction total(turns, limit) {\n  let x = 0;\n  for (let i = 0; i < turns; i++) {\n` +
        lines(size, index => `    x = x + (Tally.count < limit) + (Tally.count === ${index & 3});`) +
        `    Tally.count += 1;\n  }\n  return x;\n}\nconsole.log(total(3, JSON.parse("3")), Tally.count);\n`,
    }),
  },
  {
    name: "values made of a static field in one turn of a loop that are all read behind its last access",
    counted: "values",
    size: 1400,
    entry: "main.js",
    write: size => ({
      "main.js":
        `class Tally { static count = 1; }\nfunction total(turns) {\n  let sum = 0;\n  for (let i = 0; i < turns; i++) {\n` +
        lines(size, index => `    const k${index} = (Tally.count + ${index & 7}) | 0;`) +
        `    Tally.count += 1;\n    sum = (sum\n` +
        lines(size, index => `      + k${index}`) +
        `      ) | 0;\n  }\n  return sum;\n}\nconsole.log(total(3), Tally.count);\n`,
    }),
  },
  {
    name: "reads of a static field that are asked in front of the typed build of a loop",
    counted: "reads",
    size: 1400,
    entry: "main.js",
    write: size => ({
      "main.js":
        `"use strict";\nconst q = Number(process.argv[2] ?? 3);\nclass Store { static rows = [1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, q]; static scale = 2; }\nfunction f(t) {\n  let s = t & 1;\n  for (let i = 0; i < Store.rows.length; i++) {\n    s = s + Store.rows[i] * 2;\n` +
        lines(size, () => `    s = s + Store.scale;`) +
        `  }\n  return s;\n}\nlet sum = 0; for (let t = 0; t < 4; t++) sum = sum + f(t); console.log(sum);\n`,
    }),
  },
  {
    name: "reads of a static field behind a store into it in the typed build of a loop",
    counted: "reads",
    size: 1400,
    entry: "main.js",
    write: size => ({
      "main.js":
        `"use strict";\nconst q = Number(process.argv[2] ?? 3);\nclass Store { static rows = [1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, q]; static scale = 2; }\nfunction f(t) {\n  let s = t & 1;\n  for (let i = 0; i < Store.rows.length; i++) {\n    s = s + Store.rows[i] * 2;\n    Store.scale = (i & 3) + 1;\n` +
        lines(size, () => `    s = s + Store.scale;`) +
        `  }\n  return s;\n}\nlet sum = 0; for (let t = 0; t < 4; t++) sum = sum + f(t); console.log(sum);\n`,
    }),
  },
  {
    name: "reads of a static field of which nothing is expected in one turn of a loop",
    counted: "reads",
    size: 1400,
    entry: "main.js",
    write: size => ({
      "main.js":
        `class Tally { static count = JSON.parse("1"); }\nfunction total(turns) {\n  let sum = 0;\n  for (let i = 0; i < turns; i++) {\n` +
        lines(size, () => `    sum = (sum + Tally.count) | 0;`) +
        `    Tally.count = Tally.count + 1;\n  }\n  return sum;\n}\nconsole.log(total(3), Tally.count);\n`,
    }),
  },
  {
    name: "calls of a static method that raises a static field in one turn of a loop",
    counted: "calls",
    size: 1400,
    entry: "main.js",
    write: size => ({
      "main.js":
        `class Tally { static count = 1; static bump() { Tally.count = Tally.count + 1; return Tally.count; } }\nfunction total(turns) {\n  let sum = 0;\n  for (let i = 0; i < turns; i++) {\n` +
        lines(size, () => `    sum = (sum + Tally.bump()) | 0;`) +
        `  }\n  return sum;\n}\nconsole.log(total(3), Tally.count);\n`,
    }),
  },
  // What the variable of a published helper may hold was gone through from its first entry again at every `||` of the initializer.
  {
    name: "operands joined by || between the guard of a published helper and its function",
    counted: "operands",
    size: 10000,
    entry: "main.cjs",
    write: size => ({
      "main.cjs":
        `var __importDefault = (this && this.__importDefault) ||\n` +
        lines(size, () => `  0 ||`) +
        `  function (mod) {\n    return (mod && mod.__esModule) ? mod : { "default": mod };\n};\nconsole.log(typeof __importDefault({}).default);\n`,
    }),
  },
  // A helper that takes the first of what it is handed is copied where it is handed a generator just made. Each helper calls the one before at two places, and the copy took no heed of how much had
  // been copied at the written call already: nine helpers in a chain were copied 2,070 times, and each one more doubled that.
  {
    name: "helpers in a chain that each open a generator just made and call the one before at two places",
    counted: "helpers",
    size: 400,
    entry: "main.cjs",
    counts: ["CallsInlined", "OperationsBuilt"],
    write: size => ({
      "main.cjs":
        `"use strict";\nfunction* some(n) { for (let i = 0; i < n; i++) yield i * 2 + 1; }\nfunction w0(iter) { for (const value of iter) { return value; } return undefined; }\n` +
        lines(size, index => `function w${index + 1}(iter) { for (const value of iter) { return value > 1 ? w${index}(some(value)) : w${index}(some(2)); } return undefined; }`) +
        `function one(n) { return w${size}(some(n)); }\nglobalThis.handed = one;\nconsole.log(one(1));\n`,
    }),
  },
  // The same chain over iterators of tables just made, for which a helper is copied too.
  {
    name: "helpers in a chain that each step an iterator of a table just made and call the one before at two places",
    counted: "helpers",
    size: 400,
    entry: "main.cjs",
    counts: ["CallsInlined", "OperationsBuilt"],
    write: size => ({
      "main.cjs":
        `"use strict";\nfunction some(n) { const table = new Map(); for (let i = 0; i < n; i++) table.set(i, i * 2 + 1); return table; }\nfunction w0(steps) { for (const value of steps) { return value; } return undefined; }\n` +
        lines(size, index => `function w${index + 1}(steps) { for (const value of steps) { return value > 1 ? w${index}(some(value).values()) : w${index}(some(2).values()); } return undefined; }`) +
        `function one(n) { return w${size}(some(n).values()); }\nglobalThis.handed = one;\nconsole.log(one(1));\n`,
    }),
  },
  {
    name: "names stored under conditions and on every way into what a maker gave",
    counted: "pairs of stores",
    size: 700,
    entry: "main.ts",
    write: size => ({
      "main.ts":
        `const through = new Function("x", "return x");\ninterface Shape { flags: number; id: number; owner: number; [name: string]: unknown }\nlet count = 0; let tracer: undefined | { record(shape: Shape): void } = through(undefined);\nfunction Shape(this: Shape, flags: number) { this.flags = flags; }\nfunction createShape(flags: number): Shape { const result: Shape = new (Shape as any)(flags); count++; result.id = count; tracer?.record(result); return result; }\nfunction makeShape(owner: number): Shape { const made = createShape(8); made.owner = owner; return made; }\ninterface Wider extends Shape { wide: number }\nfunction derive(bits: number): Shape {\n  const made = makeShape(bits);\n` +
        lines(size, index => `  if (bits & ${1 << (index % 20)}) (made as Wider).a${index} = ${index};\n  made.b${index} = ${index};`) +
        `  return made;\n}\nconsole.log(Object.keys(derive(0)).length, Object.keys(derive(5)).length);\n`,
    }),
  },
  {
    name: "objects of a maker that are handed to a call in front of the names stored into them",
    counted: "objects",
    size: 700,
    entry: "main.ts",
    write: size => ({
      "main.ts":
        `const through = new Function("x", "return x");\ninterface Shape { flags: number; id: number; owner: number; [name: string]: unknown }\nlet count = 0; let tracer: undefined | { record(shape: Shape): void } = through(undefined);\nfunction Shape(this: Shape, flags: number) { this.flags = flags; }\nfunction createShape(flags: number): Shape { const result: Shape = new (Shape as any)(flags); count++; result.id = count; tracer?.record(result); return result; }\nfunction makeShape(owner: number): Shape { const made = createShape(8); made.owner = owner; return made; }\nconst kept = new Map<number, Shape>();\nfunction fill(bits: number): number {\n` +
        lines(size, index => `  const m${index} = makeShape(bits); kept.set(${index}, m${index}); m${index}.target = bits; m${index}.list = ${index};`) +
        `  return kept.size;\n}\nconsole.log(fill(3), Object.keys(kept.get(0)!).join());\n`,
    }),
  },
  {
    name: "makers of one layout that each store a name under a condition",
    counted: "makers",
    size: 700,
    entry: "main.ts",
    write: size => ({
      "main.ts":
        `const through = new Function("x", "return x");\ninterface Shape { flags: number; id: number; owner: number; [name: string]: unknown }\nlet count = 0; let tracer: undefined | { record(shape: Shape): void } = through(undefined);\nfunction Shape(this: Shape, flags: number) { this.flags = flags; }\nfunction createShape(flags: number): Shape { const result: Shape = new (Shape as any)(flags); count++; result.id = count; tracer?.record(result); return result; }\nfunction makeShape(owner: number): Shape { const made = createShape(8); made.owner = owner; return made; }\ninterface Wider extends Shape { wide: number }\n` +
        lines(size, index => `function derive${index}(bits: number): Shape { const made = makeShape(bits); if (bits & 1) (made as Wider).a${index % 40} = 1; made.b${index % 40} = 2; made.c = ${index}; return made; }`) +
        `let sum = 0;\n` +
        lines(size, index => `sum += Object.keys(derive${index}(${index & 1})).length;`) +
        `console.log(sum);\n`,
    }),
  },
  {
    name: "loops side by side whose typed build every turn leaves at a read by name while a call stays",
    counted: "loops",
    size: 200,
    entry: "main.js",
    write: size => ({
      "main.js":
        `"use strict";\nconst k = JSON.parse('"go"');\nconst V = JSON.parse("[" + Array.from({ length: 6 }, (_, i) => '{"a":' + i + ',"b":' + i / 2 + "}").join() + "]");\nconst T = { go(r) { return r.a * 2 + r.b; } };\nfunction f() { let c = 0;\n` +
        lines(size, index => `  for (let i = 0; i < 6; i++) c += T[k](V[i]) + ${index};`) +
        `  return c; }\nconsole.log(f());\n`,
    }),
  },
  {
    name: "functions that each call the one before in a loop whose typed build is tried once more in vain",
    counted: "functions",
    size: 200,
    entry: "main.js",
    write: size => ({
      "main.js":
        `"use strict";\nconst k = JSON.parse('"go"');\nconst V = JSON.parse("[" + Array.from({ length: 6 }, (_, i) => '{"a":' + i + ',"b":' + i / 2 + "}").join() + "]");\nconst T = { go(r) { return r.a * 2 + r.b; } };\nlet calls = 0;\n` +
        lines(size, index => `function g${index}(c) { if (calls++ > 4000) return c; for (let i = 0; i < 6; i++) c += T[k](V[i]) + ${index ? `g${index - 1}(${index})` : "1"}; return c % 1000003; }`) +
        `console.log(${size ? `g${size - 1}(0)` : 0});\n`,
    }),
  },
  // Calls of methods of one Map that stand in a row are walked behind one test, and every holder that their arguments read by name is asked in front of the row: once for each, whatever the length of the row.
  {
    name: "statements in a row in a turn of a loop that each set a name of another object into one Map",
    counted: "statements",
    // At 1,000 an earlier square (16 instructions x statements x statements) read 2.06 under the bound; from 4,000 to 8,000 it reads 2.22.
    size: 4000,
    entry: "main.ts",
    counts: ["OperationsBuilt"],
    write: size => ({
      "main.ts":
        `class Sym { name: unknown; flags: number; constructor(name: unknown, flags: number) { this.flags = flags; this.name = name; } }\nfunction fill(table: Map<unknown, Sym>, xs: Sym[]): void {\n  for (let turn = 0; turn < 2; turn++) {\n` +
        lines(size, index => `    const a${index} = xs[${index}];`) +
        lines(size, index => `    table.set(a${index}.name, a${index});`) +
        `  }\n}\n(globalThis as any).handed = fill;\nconst xs: Sym[] = [];\nfor (let i = 0; i < ${size}; i++) xs.push(new Sym("n" + i, i));\nconst table = new Map<unknown, Sym>();\nfill(table, xs);\nconsole.log(table.size);\n`,
    }),
  },
  {
    name: "deletes in a row of names that a literal of as many fields does not hold, and as many small literals with a delete each",
    counted: "deletes",
    // A form that listed every field of the literal at every delete read 3.78 here: fields x deletes. A literal of 8,000 fields has no slots, so the size stays below that.
    size: 2000,
    entry: "main.cjs",
    write: size => ({
      "main.cjs":
        `"use strict";\nfunction wide(i) {\n  const o = { ${upTo(Math.max(size, 1), index => `a${index}: i`).join(", ")} };\n` +
        lines(size, index => `  delete o.z${index};`) +
        `  delete o.a0;\n  return o;\n}\nfunction many(i) {\n  let s = 0;\n` +
        lines(size, index => `  const p${index} = { id: i, name: "x", n: ${index} }; delete p${index}.name; s += p${index}.n;`) +
        `  return s;\n}\nconsole.log(Object.keys(wide(1)).length, many(2));\n`,
    }),
  },
  {
    name: "calls in a row of a helper that reads two names off a parameter that declares nothing, each with an argument of a written class",
    counted: "calls",
    size: 700,
    entry: "main.ts",
    write: size => ({
      "main.ts":
        `class Leaf { from: number; to: number; constructor(from: number, to: number) { this.from = from; this.to = to; } }\nfunction isMadeUp(span: any): boolean { return span.from < 0 || span.to < 0; }\nfunction weigh(first: Leaf, second: Leaf): number {\n  let sum = 0;\n` +
        lines(size, index => `  if (isMadeUp(${index & 1 ? "first" : "second"})) sum += ${index};`) +
        `  return sum;\n}\n(globalThis as any).kept = [weigh, isMadeUp];\nconsole.log((globalThis as any).kept[0](new Leaf(1, -2), new Leaf(3, 4)));\n`,
    }),
  },
  {
    name: "helpers that each read two names off a parameter that declares nothing, each called once with an argument of a written class",
    counted: "helpers",
    size: 700,
    entry: "main.ts",
    write: size => ({
      "main.ts":
        `class Leaf { from: number; to: number; constructor(from: number, to: number) { this.from = from; this.to = to; } }\nconst kept: unknown[] = [];\n` +
        lines(size, index => `function isMadeUp${index}(span: any): boolean { return span.from < ${index} || span.to < 0; }\nfunction weigh${index}(leaf: Leaf): number { return isMadeUp${index}(leaf) ? 3 : 4; }\nkept.push(weigh${index}, isMadeUp${index});`) +
        `(globalThis as any).kept = kept;\nlet sum = 0;\nfor (let i = 0; i < kept.length; i += 2) sum += (globalThis as any).kept[i](new Leaf(i, 1));\nconsole.log(sum);\n`,
    }),
  },
  // What a guard on a parameter may expect was put together anew for each function, out of every layout that has the name which the function reads: functions x layouts. 6,000 of each took 16.9 G instructions where 4.3 G had done, and 24,000 took 217 G for 15.6 G.
  {
    name: "functions that each read one name off their parameter, beside as many literals of different layouts that have it",
    counted: "functions, and layouts",
    size: 1500,
    entry: "main.js",
    write: size => ({
      "main.js":
        `const things = [\n${lines(size, index => `  { shared: ${index}, own${index}: ${index} },`)}];\n` +
        lines(size, index => `function read${index}(thing) { return thing.shared + ${index}; }`) +
        `let sum = 0;\n` +
        lines(size, index => `sum += read${index}(things[${index}]);`) +
        `console.log(sum);\n`,
    }),
  },
  // What lies above the receivers of a store was asked of every layout that the receiver may have, and the guard on the parameter held every one of those layouts against every name that the function uses:
  // functions x layouts, twice. 4,000 of each took 8.3 G instructions.
  {
    name: "functions that each store a name of their own on their parameter, beside as many literals of different layouts",
    counted: "functions, and layouts",
    size: 1500,
    entry: "main.js",
    write: size => ({
      "main.js":
        `const things = [\n${lines(size, index => `  { shared: ${index}, own${index}: ${index} },`)}];\n` +
        lines(size, index => `function mark${index}(thing) { thing.extra${index} = ${index}; return thing.shared; }`) +
        `let sum = 0;\n` +
        lines(size, index => `sum += mark${index}(things[${index}]);`) +
        `console.log(sum);\n`,
    }),
  },
  // Behind a computed store or a delete nothing is known of an object's slots, so stores by name look at their slots first, all of them in front of the first store. What was held of those looks was ended
  // by each store under every name that shares its bit among sixty-four, once the held places were gone through by lists, so the looks were laid again every ten stores or so, for all the stores left.
  // Each search for the stores that one guess covers held every store against all the earlier ones besides. 4,000 stores took 175 G instructions.
  {
    name: "functions stored by name on an object that globalThis keeps, behind one computed store",
    counted: "stores",
    size: 1000,
    entry: "main.cjs",
    write: size => ({
      "main.cjs": `const all = require("./lib.cjs");\nconsole.log(Object.keys(all).length, typeof all.f7);\n`,
      "lib.cjs":
        `module.exports = (function () {\n  const all = {};\n  globalThis.kept = all;\n  globalThis[process.argv[9] || "none"]?.(all);\n  all["x" + process.argv.length] = 1;\n` +
        lines(size, index => `  all.f${index} = () => "an${index}";`) +
        `  return all;\n})();\n`,
    }),
  },
  {
    name: "functions stored by name on an object behind one computed store, in a file that a test requires",
    counted: "stores",
    size: 1000,
    entry: "a.test.js",
    isTestRun: true,
    write: size => ({
      "package.json": `{}\n`,
      "a.test.js": `import { expect, test } from "bun:test";\nimport { createRequire } from "node:module";\nconst ask = createRequire(import.meta.url);\ntest("it counts", () => {\n  expect(Object.keys(ask("./lib.cjs")).length).toBe(${size + 1});\n});\n`,
      "lib.cjs":
        `module.exports = (function () {\n  const all = {};\n  all["x" + process.argv.length] = 1;\n` + lines(size, index => `  all.f${index} = () => "an${index}";`) + `  return all;\n})();\n`,
    }),
  },
  {
    name: "functions stored by name on an object behind one delete, in a file that a test requires",
    counted: "stores",
    size: 1000,
    entry: "a.test.js",
    isTestRun: true,
    write: size => ({
      "package.json": `{}\n`,
      "a.test.js": `import { expect, test } from "bun:test";\nimport { createRequire } from "node:module";\nconst ask = createRequire(import.meta.url);\ntest("it counts", () => {\n  expect(Object.keys(ask("./lib.cjs")).length).toBe(${size});\n});\n`,
      "lib.cjs":
        `module.exports = (function () {\n  const all = {};\n  all.gone = 1;\n  delete all.gone;\n` + lines(size, index => `  all.f${index} = () => "an${index}";`) + `  return all;\n})();\n`,
    }),
  },
  // What still grows: each store goes through the held slots that share its bit among sixty-four, and each look goes through the blocks that are awaited to find the one where the guess fails.
  {
    name: "twice as many functions stored by name on an object behind one delete, in a file that a test requires",
    counted: "stores",
    size: 2000,
    entry: "a.test.js",
    isTestRun: true,
    growsSoFarInInstructions: "2.18 times in instructions",
    write: size => ({
      "package.json": `{}\n`,
      "a.test.js": `import { expect, test } from "bun:test";\nimport { createRequire } from "node:module";\nconst ask = createRequire(import.meta.url);\ntest("it counts", () => {\n  expect(Object.keys(ask("./lib.cjs")).length).toBe(${size});\n});\n`,
      "lib.cjs":
        `module.exports = (function () {\n  const all = {};\n  all.gone = 1;\n  delete all.gone;\n` + lines(size, index => `  all.f${index} = () => "an${index}";`) + `  return all;\n})();\n`,
    }),
  },
  // A parameter `options = {}` of a file without types is asked for its use, as one without a default is.
  {
    name: "functions with an empty default that each read two names off it and hand it on to the next",
    counted: "functions",
    size: 600,
    entry: "main.js",
    write: size => ({
      "main.js":
        `"use strict";\n` +
        lines(size, index => `function step${index}(width, options = {}) { return (options.name${index} === undefined ? 1 : 0) + (options.shared | 0) + ${index + 1 < size ? `step${index + 1}(width, options)` : "0"}; }`) +
        `console.log(${size ? "step0(1, { shared: 2, name0: 1 }) + step0(1)" : "0"});\n`,
    }),
  },
  {
    name: "names read off one parameter with an empty default, a statement each",
    counted: "names",
    size: 1600,
    entry: "main.js",
    write: size => ({
      "main.js":
        `"use strict";\nfunction take(width, options = {}) {\n  let sum = width;\n` +
        lines(size, index => `  sum += options.name${index} | 0;`) +
        `  return sum;\n}\nconsole.log(take(1) + take(2, { name0: 1 }));\n`,
    }),
  },
  {
    name: "functions with an empty default, each handed a literal of its own names and one shared name through a table",
    counted: "functions, and layouts",
    size: 600,
    entry: "main.js",
    write: size => ({
      "main.js":
        `"use strict";\n` +
        lines(size, index => `function take${index}(width, options = {}) { return width + (options.first${index} | 0) + (options.second${index} === undefined ? 1 : 0) + (options.shared | 0); }`) +
        `const table = { ${upTo(size, index => `take${index}`).join(", ")} }; const keys = JSON.parse(JSON.stringify(Object.keys(table))); let sum = 0;\n` +
        lines(size, index => `sum += table[keys[${index}]](${index}, { first${index}: 1, shared: 2 }) + table[keys[${index}]](${index});`) +
        `console.log(sum);\n`,
    }),
  },
  {
    name: "calls in a row of a helper whose head asks bits that a helper called at the top has asked of the same object",
    counted: "calls",
    size: 700,
    entry: "main.ts",
    write: size => ({
      "main.ts":
        `class Notes { marks: number; constructor(marks: number) { this.marks = marks; } }\nclass Item { bits: number; id: number; notes: Notes | undefined; constructor(bits: number, id: number) { this.bits = bits; this.id = id; this.notes = bits & 32 ? new Notes(id) : undefined; } }\nconst shelf: Notes[] = [];\nfunction marksOf(item: Item): number { return item.bits & 32 ? item.notes!.marks : 0; }\nfunction notesOf(item: Item): Notes { if (item.bits & 32) return item.notes!; const id = item.id; return shelf[id] ?? (shelf[id] = new Notes(0)); }\nfunction weigh(item: Item): number {\n  let sum = marksOf(item);\n` +
        lines(size, index => `  sum += notesOf(item).marks + ${index};`) +
        `  return sum;\n}\n(globalThis as any).kept = [weigh, notesOf, marksOf];\nconsole.log((globalThis as any).kept[0](new Item(32, 3)));\n`,
    }),
  },
  {
    name: "conditions in a row that each ask bits of another parameter and call a helper whose head asks them again",
    counted: "conditions",
    size: 200,
    entry: "main.ts",
    write: size => ({
      "main.ts":
        `class Notes { marks: number; constructor(marks: number) { this.marks = marks; } }\nclass Item { bits: number; id: number; notes: Notes | undefined; constructor(bits: number, id: number) { this.bits = bits; this.id = id; this.notes = bits & 32 ? new Notes(id) : undefined; } }\nconst shelf: Notes[] = [];\nfunction notesOf(item: Item): Notes { if (item.bits & 32) return item.notes!; const id = item.id; return shelf[id] ?? (shelf[id] = new Notes(0)); }\nfunction weigh(${upTo(size, index => `item${index}: Item`).join(", ")}): number {\n  let sum = 0;\n` +
        lines(size, index => `  if (item${index}.bits & 32) sum += notesOf(item${index}).marks;`) +
        `  return sum;\n}\n(globalThis as any).kept = [weigh, notesOf];\nconst one = new Item(32, 3);\nconsole.log((globalThis as any).kept[0](${upTo(size, () => "one").join(", ")}));\n`,
    }),
  },
  // Whether a read is evaluated for some values only was asked by climbing every parent of the read, anew for each read: reads x the depth of the sum. 12,800 took 3.9 G instructions, 1.6 now.
  {
    name: "reads of names off one parameter without a type, all in one sum",
    counted: "reads",
    size: 6400,
    entry: "main.js",
    write: size => ({
      "main.js": `"use strict";\nfunction take(width, options) { return width${upTo(size, index => ` + (options.name${index} | 0)`).join("")}; }\nconsole.log(take(2, { name0: 1 }));\n`,
    }),
  },
  // Whether a name is given a product somewhere was asked of every store to the name, anew for each read of it as an int32: reads x stores. 6,400 of each took 23.9 G instructions, 12,800 took 93 G; 1.6 now.
  {
    name: "stores to one parameter without a type, each read as an int32",
    counted: "stores, and reads",
    size: 6400,
    entry: "main.js",
    write: size => ({
      "main.js":
        `"use strict";\nfunction take(width, value) {\n  let sum = 0;\n` +
        lines(size, index => `  value = width + ${index};\n  sum += value | 0;`) +
        `  return sum;\n}\nconsole.log(take(2, 1));\n`,
    }),
  },
  {
    name: "conditions in a row that hand another element on, once with nothing read between and once with a name of its own read behind each",
    counted: "conditions",
    size: 1000,
    entry: "main.js",
    write: size => ({
      "main.js":
        `class Shape { constructor(w, h) { this.width = w; this.height = h; } }\nfunction pick(flags, other) {\n  let x = other[0];\n  let y = other[0];\n  let sum = 0;\n` +
        lines(size, index => `  if (flags[${index + 1}]) x = other[${index + 1}];`) +
        lines(size, index => `  if (flags[${index + 1}]) y = other[${index + 1}];\n  sum += y.n${index + 1} | 0;`) +
        `  return x.width + x.height + sum;\n}\nconsole.log(new Shape(1, 2).width + pick(JSON.parse("[]"), JSON.parse('[{"width":1,"height":2}]')));\n`,
    }),
  },
  {
    name: "conditions in a row in a loop that hand another element on, once with nothing read between and once with a name of its own read behind each",
    counted: "conditions",
    size: 500,
    entry: "main.js",
    write: size => ({
      "main.js":
        `class Shape { constructor(w, h) { this.width = w; this.height = h; } }\nfunction pick(flags, other, turns) {\n  let x = other[0];\n  let y = other[0];\n  let sum = 0;\n  for (let turn = 0; turn < turns; turn++) {\n` +
        lines(size, index => `    if (flags[${index + 1}]) x = other[${index + 1}];`) +
        lines(size, index => `    if (flags[${index + 1}]) y = other[${index + 1}];\n    sum += y.n${index + 1} | 0;`) +
        `  }\n  return x.width + x.height + sum;\n}\nconsole.log(new Shape(1, 2).width + pick(JSON.parse("[]"), JSON.parse('[{"width":1,"height":2}]'), 2));\n`,
    }),
  },
  {
    name: "loops in a row that each store a captured place and read a captured text through two helpers",
    counted: "loops",
    size: 60,
    entry: "main.ts",
    write: size => ({
      "main.ts":
        `function pointOf(text: string, at: number): number { return text.codePointAt(at) as number; }\nfunction makeReader() {\n  var letters: string;\n  var place: number;\n  var limit: number;\n  function codeAt(at: number) { return letters.charCodeAt(at); }\n  function pointAt(at: number) { return pointOf(letters, at); }\n  function skim(): number {\n    let sum = 0;\n` +
        lines(size, index => `    for (let code = codeAt(place); place < limit && code !== ${index + 200}; code = pointAt(++place)) {\n      if (code === 123) break;\n    }\n    sum += place;\n    place = 0;`) +
        `    return sum;\n  }\n  function reset(next: string) { letters = next; place = 0; limit = next.length; }\n  return { skim, reset };\n}\n(globalThis as any).kept = makeReader();\n(globalThis as any).kept.reset("abc");\nconsole.log((globalThis as any).kept.skim());\n`,
    }),
  },
  {
    name: "loops in a row that each store a captured place and read a captured text through two helpers, all declared by let",
    counted: "loops",
    size: 60,
    entry: "main.ts",
    write: size => ({
      "main.ts":
        `function pointOf(text: string, at: number): number { return text.codePointAt(at) as number; }\nfunction makeReader() {\n  let letters = "";\n  let place = 0;\n  let limit = 0;\n  function codeAt(at: number) { return letters.charCodeAt(at); }\n  function pointAt(at: number) { return pointOf(letters, at); }\n  function skim(): number {\n    let sum = 0;\n` +
        lines(size, index => `    for (let code = codeAt(place); place < limit && code !== ${index + 200}; code = pointAt(++place)) {\n      if (code === 123) break;\n    }\n    sum += place;\n    place = 0;`) +
        `    return sum;\n  }\n  function reset(next: string) { letters = next; place = 0; limit = next.length; }\n  return { skim, reset };\n}\n(globalThis as any).kept = makeReader();\n(globalThis as any).kept.reset("abc");\nconsole.log((globalThis as any).kept.skim());\n`,
    }),
  },
  // The first walk of a loop took every variable of the scope around it for stored by its turns: each became a parameter of the head, and what the turns do store was ended by going
  // through all of them. A loop paid for every variable alive across it: 2,500 variables and 1,700 loops took 19 G instructions, 5,000 and 3,200 took 68 G, and at 20,000 the build died.
  {
    name: "variables at the head of one function with a handler, and loops in a row behind them that each store one",
    counted: "variables",
    size: 1200,
    entry: "main.js",
    write: size => ({
      "main.js":
        `function mix(s, v) { return (s * 33 + v) % 1000000007; }\nfunction big(rare) {\n  let s = 1;\n` +
        lines(size, index => `  let v${index} = 0;`) +
        `  try {\n` +
        lines(size, index => (index % 3 ? `` : `    while (v${index} !== v${index}) v${index} = [v${index}];\n`) + `    v${index} = ${index}.25;`) +
        `    if (rare) throw new Error("rare");\n  } catch (e) {\n` +
        lines(size, index => (index % 5 ? `` : `    while (s !== s) s = [s];\n`) + `    s = mix(s, v${index} * 3);`) +
        `  }\n` +
        lines(size, index => (index % 4 ? `` : `  while (v${index} !== v${index}) v${index} = [v${index}];\n`) + `  s = mix(s, v${index} * 4);`) +
        `  return s;\n}\nconsole.log(big(false), big(true));\n`,
    }),
  },
  // The first walk of a loop takes its turns to run other code, and ends all that is known of what was not made here, record by record; the walk is undone and what was known is there again
  // for the next loop to end.
  {
    name: "variables at the head of one function that are given elements of two lists within reach of a handler, with loops between that each store one",
    counted: "variables",
    size: 2400,
    entry: "main.js",
    write: size => ({
      "main.js":
        `const a = [], b = [];\nfor (let i = 0; i < ${size}; i++) { a.push(i + 0.25); b.push(i * 7); }\nfunction big(a, b, rare) {\n  let s = 1;\n` +
        lines(size, index => `  let v${index} = 0;`) +
        `  try {\n` +
        lines(size, index => (index % 3 ? `` : `    while (v${index} !== v${index}) v${index} = [v${index}];\n`) + `    v${index} = ${index % 2 ? "a" : "b"}[${index}];`) +
        `    if (rare) throw new Error("rare");\n  } catch (e) {\n  }\n  return s;\n}\nconsole.log(big(a, b, false), big(a, b, true));\n`,
    }),
  },
  {
    name: "loops in a row that each store a captured place and read a captured text by a helper that calls the method itself",
    counted: "loops",
    size: 60,
    entry: "main.ts",
    write: size => ({
      "main.ts":
        `function makeReader() {\n  var letters: string;\n  var place: number;\n  var limit: number;\n  function codeAt(at: number) { return letters.charCodeAt(at); }\n  function pointAt(at: number) { return letters.codePointAt(at) as number; }\n  function skim(): number {\n    let sum = 0;\n` +
        lines(size, index => `    for (let code = codeAt(place); place < limit && code !== ${index + 200}; code = pointAt(++place)) {\n      if (code === 123) break;\n    }\n    sum += place;\n    place = 0;`) +
        `    return sum;\n  }\n  function reset(next: string) { letters = next; place = 0; limit = next.length; }\n  return { skim, reset };\n}\n(globalThis as any).kept = makeReader();\n(globalThis as any).kept.reset("abc");\nconsole.log((globalThis as any).kept.skim());\n`,
    }),
  },
  {
    name: "functions that each loop over a list whose rows have the names of a literal that stays in its own function",
    counted: "functions",
    size: 400,
    entry: "main.js",
    write: size => ({
      "main.js":
        `const crates = JSON.parse('[{"wide":1.5,"tall":2.5,"drift":0.5,"sink":0.25},{"wide":2.5,"tall":3.5,"drift":0.75,"sink":0.5}]');\nfunction weighOne(i) { const crate = { wide: i + 0.5, tall: i * 0.5, drift: i * 0.25, sink: 0.5 }; return crate.wide + crate.tall + crate.drift + crate.sink; }\nlet sum = weighOne(3);\n` +
        lines(size, index => `function shift${index}(list, by) { for (let i = 0; i < list.length; i++) { const c = list[i]; c.sink += ${index + 1} * by; c.wide += c.drift * by; c.tall += c.sink * by; } }\nshift${index}(crates, 0.5);`) +
        `console.log(sum + crates[0].wide + crates[1].tall);\n`,
    }),
  },
  {
    name: "groups of four classes that each answer one name in their own way, called in a loop over a list of the group",
    counted: "groups",
    size: 150,
    entry: "main.ts",
    write: size => ({
      "main.ts":
        `const picks: number[] = JSON.parse("[0,1,2,3,2,1,0,3]");\nlet sum = 0;\n` +
        lines(size, index => `interface Kind${index} { weigh${index}(): number }\nclass A${index} implements Kind${index} { constructor(private a: number) {} weigh${index}(): number { return this.a + ${index}; } }\nclass B${index} implements Kind${index} { constructor(private b: number) {} weigh${index}(): number { return this.b * 2; } }\nclass C${index} implements Kind${index} { constructor(private c: number) {} weigh${index}(): number { return this.c - 1; } }\nclass D${index} implements Kind${index} { constructor(private d: number) {} weigh${index}(): number { return 0 * this.d; } }\nfunction make${index}(pick: number): Kind${index} { return pick === 0 ? new A${index}(pick) : pick === 1 ? new B${index}(pick) : pick === 2 ? new C${index}(pick) : new D${index}(pick); }\nfunction all${index}(list: Kind${index}[]): number { let s = 0; for (const each of list) s += each.weigh${index}(); return s; }\nsum += all${index}(picks.map(make${index}));`) +
        `console.log(sum);\n`,
    }),
  },
  // A walk of a loop that believes a variable as it stood in front folds away the test behind which a helper stores the next variable, so each walk learned one store more:
  // as many walks as helpers, each over all the calls, up to the bound on the tries of one loop, behind which the loop claimed nothing: 30 helpers walked 8,826 values, 60 walked 33,816.
  {
    name: "helpers called in one loop that each store a variable behind a test of the variable that the next call stores",
    counted: "helpers",
    size: 30,
    entry: "main.js",
    counts: ["ValuesWalked"],
    write: size => ({
      "main.js":
        `function run(turns) {\n` +
        lines(size, index => `  let v${index} = 0;`) +
        lines(size, index => `  const h${index} = () => { v${index} = v${index} + 1; };`) +
        `  let n = 0;\n  while (n !== turns) {\n` +
        lines(size, index => (index === size - 1 ? `    h0();` : `    if (v${size - 2 - index} !== 0) h${size - 1 - index}();`)) +
        `    n = n + 1;\n  }\n  return [n${upTo(size, index => `, v${index}`).join("")}].join();\n}\nconsole.log(run(0), run(1), run(3));\n`,
    }),
  },
  {
    name: "helpers called in a nest of two loops that each store a variable behind a test of the variable that the next call stores",
    counted: "helpers",
    size: 30,
    entry: "main.js",
    counts: ["ValuesWalked"],
    write: size => ({
      "main.js":
        `function run(turns) {\n` +
        lines(size, index => `  let v${index} = 0;`) +
        lines(size, index => `  const h${index} = () => { v${index} = v${index} + 1; };`) +
        `  let n = 0;\n  while (n !== turns) {\n    let m = 0;\n    while (m !== 2) {\n` +
        lines(size, index => (index === size - 1 ? `      h0();` : `      if (v${size - 2 - index} !== 0) h${size - 1 - index}();`)) +
        `      m = m + 1;\n    }\n    n = n + 1;\n  }\n  return [n${upTo(size, index => `, v${index}`).join("")}].join();\n}\nconsole.log(run(0), run(1), run(3));\n`,
    }),
  },
  // The constants of a function lie in a pool, and a table finds them there. The table went by the low bits of a product, which are nought for every number with a short mantissa: whole numbers,
  // halves, powers of two. All of them fell into one bucket, and each one written searched all that stood there: 16,000 took 16 G instructions.
  {
    name: "numbers with short mantissas that one function multiplies by",
    counted: "numbers",
    size: 4000,
    entry: "main.js",
    write: size => ({
      "main.js":
        `function mix(x) {\n  let t = 0.5;\n` +
        lines(size, index => `  t += x * ${(1 + (index % 16) / 16) * 2 ** (Math.floor(index / 16) - 400)};`) +
        `  return t;\n}\nconsole.log(mix(JSON.parse("7.5")) > 0);\n`,
    }),
  },
  // Each loop leaves for where the cases meet and hands every variable on. What a loop mentions of the values in front of it was listed without doubles by a search through the list at every
  // mention: 8,000 variables took 9 G instructions, and as many cases as variables a cube.
  {
    name: "variables of one function that forty cases of a switch share out, each case with a loop behind its stores",
    counted: "variables",
    size: 2000,
    entry: "main.js",
    write: size => ({
      "main.js":
        `function run(k, which) {\n` +
        lines(size, index => `  let v${index} = ${index};`) +
        `  let s = 0;\n  switch (which) {\n` +
        lines(40, part => `    case ${part}:\n` + upTo(size, index => (index % 40 === part ? `      v${index} = k + ${index};\n` : ``)).join("") + `      for (let i = 0; i < k; i++) s = s + i;\n      break;`) +
        `  }\n  return s${upTo(size, index => ` + v${index}`).join("")};\n}\nconsole.log(run(JSON.parse("3"), JSON.parse("5")), run(3, -1));\n`,
    }),
  },
  // The first walk of each loop took its turns to run other code, though nothing in them can, and ended all that was known of the list, element by element; the walk was undone and
  // the next loop ended it all again: 1,250 variables took 2.0 G instructions, 2,500 took 5.8 G, 5,000 took 19.9 G. Where each loop stores a variable too: 2.5 G and 8.1 G.
  {
    name: "variables that a closure names, each given an element of a list, with a loop behind each that stores the name of the list",
    counted: "variables",
    size: 1250,
    entry: "main.js",
    write: size => ({
      "main.js":
        `function large(a) {\n  const get = () => [${upTo(size, index => `v${index}`).join(", ")}];\n` +
        lines(size, index => `  var v${index} = a[${index}]; while (a !== a) a = [a];`) +
        `  return get();\n}\nconst list = [];\nfor (let i = 0; i < ${size}; ++i) list.push(i);\nconsole.log("SAID", large(list).length);\n`,
    }),
  },
  {
    name: "variables that a closure names, each given an element of a list, with a loop behind each that stores the name of the list and the variable",
    counted: "variables",
    size: 1250,
    entry: "main.js",
    write: size => ({
      "main.js":
        `function large(a) {\n  const get = () => [${upTo(size, index => `v${index}`).join(", ")}];\n` +
        lines(size, index => `  var v${index} = a[${index}]; while (a !== a) { a = [a]; v${index} = 0; }`) +
        `  return get();\n}\nconst list = [];\nfor (let i = 0; i < ${size}; ++i) list.push(i);\nconsole.log("SAID", large(list).length);\n`,
    }),
  },
  {
    name: "copies of one object by spread with a name behind each, in one function",
    counted: "copies",
    size: 2000,
    entry: "main.js",
    write: size => ({
      "main.js":
        `function run() {\n  const o = { a: 1, b: 2 };\n  let q;\n` +
        lines(size, index => `  q = { ...o, z: ${index} };`) +
        `  return q.z + q.a;\n}\nconsole.log("SAID", run());\n`,
    }),
  },
  // A helper lays getters off a table, as bundlers write it. What is expected at the reads is found from each target's own readers: once a target, however often it is filled.
  ...(
    [
      ["calls of the helper on one target, a name each", (size: number) => `const ns = {};\n` + lines(size, index => `lay(ns, { a${index}: () => f${index} });`), (index: number) => `ns.a${index}()`],
      ["targets that the helper fills with a name each", (size: number) => lines(size, index => `const ns${index} = {}; lay(ns${index}, { a${index}: () => f${index} });`), (index: number) => `ns${index}.a${index}()`],
      ["names of one table that the helper lays on one target", (size: number) => `const ns = {};\nlay(ns, { ${upTo(size, index => `a${index}: () => f${index}`).join(", ")} });\n`, (index: number) => `ns.a${index}()`],
    ] as const
  ).map(
    ([counted, fill, call]): Shape => ({
      name: `getters that a helper lays off a table, each called in one loop: ${counted}`,
      counted,
      size: 1000,
      entry: "main.js",
      write: size => ({
        "main.js":
          `function lay(target, all) { for (var name in all) Object.defineProperty(target, name, { get: all[name], enumerable: true }); }\n` +
          lines(size, index => `function f${index}() { return ${index}; }`) +
          fill(size) +
          `let sum = 0;\nfor (let turn = 0; turn < 3; turn++) {\n` +
          lines(size, index => `  sum += ${call(index)};`) +
          `}\nconsole.log("SAID", sum);\n`,
      }),
    }),
  ),
  // K functions `{ ...state, fK: v }` over one record of K fields: every reducer, only larger. The text is K lines; each copy means K fields. What is asked of the record's layout is to be asked once, and
  // a place to add what it writes itself. The type checker builds the type of each literal property by property, twice: that is what is left in instructions.
  ...(
    [
      ["called by name", 400, { growsSoFarInInstructions: "3.50 times in instructions" }],
      ["reached through a table", 250, { growsSoFarInInstructions: "2.81 times in instructions" }],
      ["reached through a table, that lay one name more", 250, { growsSoFarInInstructions: "2.80 times in instructions" }],
    ] as const
  ).map(
    ([how, size, mark]): Shape => ({
      name: `setters by spread of one record, ${how}`,
      counted: "fields of the record, and as many functions",
      size,
      entry: "main.ts",
      ...mark,
      write: size => ({
        "tsconfig.json": withoutLibraryTypes,
        "main.ts":
          `${declaredConsole}export {};\ninterface State {\n  first: number;\n${lines(size, index => `  f${index}: number;`)}}\n` +
          (how.endsWith("more") ? `interface Wide extends State { extra: number; }\n` : ``) +
          lines(size, index =>
            how.endsWith("more")
              ? `function set${index}(state: State, v: number): Wide { return { ...state, extra: v + ${index} }; }`
              : `function set${index}(state: State, v: number): State { return { ...state, f${index}: v }; }`,
          ) +
          `let state: State = { first: 1, ${upTo(size, index => `f${index}: ${index % 7}`).join(", ")} };\n` +
          (how === "called by name"
            ? lines(size, index => `state = set${index}(state, ${index % 7});`)
            : `const table: Record<string, (state: State, v: number) => State> = { ${upTo(size, index => `set${index}`).join(", ")} };\n` +
              `const keys: string[] = JSON.parse(JSON.stringify(Object.keys(table)));\nfor (const key of keys) state = table[key](state, 3);\n`) +
          `console.log(Object.keys(state).length, state.first);\n`,
      }),
    }),
  ),
  // `x instanceof C` in a loop is answered by the shapes of the classes of C's tree. Each asking went through every class of the family, climbed from each to the top and looked each up in two
  // lists that grew with them: classes x classes. 2,000 classes took 2.65 G instructions, then 2.05 G; what a doubling adds grew 2.5 times, then 2.0 times.
  {
    name: "classes below one base, objects of all of them asked in one loop whether they are of six of the classes",
    counted: "classes",
    size: 1000,
    entry: "main.js",
    write: size => ({
      "main.js":
        `class Base { constructor(x) { this.x = x; } }\n` +
        lines(size, index => `class C${index} extends ${index % 4 === 3 ? `C${index - 1}` : "Base"} {}`) +
        `const makers = [Base, ${upTo(size, index => `C${index}`).join(", ")}];\n` +
        `const picks = JSON.parse("[" + Array.from({ length: 64 }, (_, i) => (i * 37) % makers.length).join() + "]");\n` +
        `const things = picks.map((pick, i) => new makers[pick](i));\n` +
        `function count() {\n  let sum = 0;\n  for (let i = 0; i < things.length; i++) {\n    const thing = things[i];\n` +
        lines(6, question => `    if (thing instanceof ${size ? `C${(question * 37) % size}` : "Base"}) sum += ${question + 1};`) +
        `  }\n  return sum;\n}\nlet all = 0;\nfor (let turn = 0; turn < 30; turn++) all += count();\nconsole.log(all);\n`,
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
