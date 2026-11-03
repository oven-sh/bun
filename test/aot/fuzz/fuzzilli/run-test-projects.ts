// Draws small projects of test files and helper modules and runs each under `bun test` and under `bun test --aot` with the same flags.
// A project is kept where a test ends otherwise, counts other assertions or sees other values, where a file is run in one of the two alone, or where the compiled run ends by a signal or never ends.
//
//   bun run-test-projects.ts --bun <the Bun that runs the tests> --work <folder> --finds <folder> [--seconds 3600] [--projects 0] [--seed <text>] [--flags="--isolate --parallel=4"]
//   --without "require.cache"          tests of these kinds are not drawn: what such a test does to a module shows in the tests behind it, so leaving it out of the comparison is not enough
//   --only "a Worker,fake timers"     only tests of these kinds are drawn; --pure: test files of drawn kinds alone: no scenes, no files that do not run, no file that opens the modules
//   --bare                             every project is bare: its test files import bun:test alone and name no built-in module (12 of 100 projects are, without the option)
//   --sparse                           every project is sparse: two or three kinds in all its files (25 of 100 projects are, without the option)
//   --ends-within 120                  seconds for one run of a project. A lane that is given few processors on a busy machine needs more: a build that takes 40 s took more than 120 there
//   --reduce <folder of a find> [--must "EvalError"]   makes the project of a find smaller, into <folder>/reduced: whole files go first, then lines by halves, as long as the two runs differ
//                                      in the same way in a test of the same kind or, with --must, as long as the compiled run alone says those words
//   --words TestRunLayers:2,TestRunPartFiles:2   BUN_DEBUG_TEST_AOT_WORDS for the compiled runs: how the run is built (layers and pieces); a project has few test files, so say how many a piece holds
//                                      TestRunPartFiles:drawn: 1, 2, 3 or 16, drawn for each project (not with --reduce or --project: the report of a find says the number)
//   --project <folder>                 runs the project in that folder both ways, once, and says in what they differ
//   --known "require.cache,a Worker"   tests of these kinds are left out of the comparison: a fault that is known would else be the first difference of every project that holds it
//
// Each test writes down what it sees, and its file stores that in a folder of the run, so a wrong value shows where no `expect` asks for it.
// Plain `bun test` runs twice: a project that answers itself otherwise is dropped. Half of the projects that agree run compiled once more, with BUN_JSC_validateAOTRuntime=1.
// The name of a test begins with its kind, and a find is filed under the kind of the first test that differs: five projects to a kind are kept.
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { randomFrom } from "./print-members-of-objects.ts";
import { writeOrdinaryScenes } from "./write-ordinary-scenes.ts";

const { values: options } = parseArgs({
  options: {
    bun: { type: "string", default: process.execPath },
    work: { type: "string", default: "" },
    finds: { type: "string", default: "" },
    seconds: { type: "string", default: "3600" },
    projects: { type: "string", default: "0" },
    seed: { type: "string", default: String(Date.now()) + process.pid },
    flags: { type: "string", default: "" },
    "only-write": { type: "string", default: "" },
    known: { type: "string", default: "" },
    without: { type: "string", default: "" },
    only: { type: "string", default: "" },
    pure: { type: "boolean", default: false },
    bare: { type: "boolean", default: false },
    sparse: { type: "boolean", default: false },
    "ends-within": { type: "string", default: "120" },
    reduce: { type: "string", default: "" },
    must: { type: "string", default: "" },
    project: { type: "string", default: "" },
    words: { type: "string", default: "" },
  },
});

class Project {
  readonly files = new Map<string, string>();
  graph = { count: 0, nameOf: (index: number) => String(index) };
  /** One import() whose name no build can know, anywhere in a run, leaves every module of the run loadable by name. Both kinds of run are drawn. */
  opensTheModules = false;
  /** The files of the project that use the drawn packages. */
  made: string[] = [];
  /** No test file of the project names a built-in module: each imports bun:test alone. */
  bare = false;
  /** The two or three kinds that all files of a sparse project are drawn from, or none. */
  sparse: string[] = [];
  /** The one kind that the file being written holds, or "". */
  onlyKind = "";
  readonly below: (bound: number) => number;
  readonly chance: (percent: number) => boolean;
  constructor(readonly seed: string) {
    const random = randomFrom("test project " + seed);
    this.below = bound => Math.floor(random() * bound);
    this.chance = percent => random() * 100 < percent;
  }
  pick = <T>(from: readonly T[]) => from[this.below(from.length)];
  several = <T>(least: number, most: number, make: (index: number) => T) =>
    Array.from({ length: least + this.below(most - least + 1) }, (_, index) => make(index));
}

/** What the helpers are imported as, and the statement that imports each. */
const helpers = {
  state: `import * as state from "./helpers/state.js";`,
  math: `import * as math from "./helpers/math.ts";`,
  scale: `import scale from "./helpers/math.ts";`,
  counters: `import * as counters from "./helpers/counters.ts";`,
  uses: `import * as uses from "./helpers/uses.js";`,
  builtins: `import * as builtins from "./helpers/builtins.js";`,
  nodes: `import * as nodes from "./helpers/nodes.ts";`,
  shapes: `import * as shapes from "./helpers/shapes.ts";`,
  packages: `import * as packages from "./helpers/packages.js";`,
  again: `import * as again from "./helpers/again.ts";`,
};

/**
 * Packages as applications have them, and files of the project that call what they export, some while they are loaded. A build in layers compiles the packages without seeing who calls them.
 * Drawn: ES or CommonJS, what the default export is, whether it lies in an inner file, sideEffects, main or exports, whether and how a package reads its own package.json, which package uses which and when.
 */
function writeDrawnPackages(project: Project) {
  type Package = { name: string; isModule: boolean; call: (id: string) => string };
  const packages: Package[] = [];
  const count = 2 + project.below(5);
  for (let n = 0; n < count; n++) {
    const name = project.chance(20) ? `@drawn/pkg-${n}` : `drawn-pkg-${n}`;
    const isModule = project.chance(65);
    const shape = project.pick(["function", "arrow", "class", "object", "factory"]);
    const call = (id: string) =>
      shape === "class"
        ? `new ${id}("a").say()`
        : shape === "object"
          ? `${id}.run("a")`
          : shape === "factory"
            ? `${id}.extend({ n: 2 })("a")`
            : `${id}("a")`;
    const candidates = packages.filter(other => isModule || !other.isModule);
    const below = candidates.length && project.chance(50) ? project.pick(candidates) : undefined;
    const belowAtLoad = below !== undefined && project.chance(50);
    const tail = below ? (belowAtLoad ? ` + "<" + atLoad` : ` + "<" + ${below.call("below")}`) : "";
    const value =
      shape === "function"
        ? `function make(x) { return "${name}(" + x + ")"${tail}; }`
        : shape === "arrow"
          ? `x => "${name}(" + x + ")"${tail}`
          : shape === "class"
            ? `class Made { constructor(x) { this.x = x; } say() { return "${name}(" + this.x + ")"${tail}; } }`
            : shape === "object"
              ? `{ run(x) { return "${name}(" + x + ")"${tail}; }, never() { return "never called"; } }`
              : `(function build(options) { const api = x => "${name}(" + x + "," + options.n + ")"${tail}; api.extend = more => build({ ...options, ...more }); return api; })({ n: 1 })`;
    const reads = project.pick(
      isModule ? ["none", "none", "createRequire", "json import"] : ["none", "require", "require"],
    );
    const inner = project.chance(40);
    const head = below
      ? (isModule ? `import below from "${below.name}";\n` : `const below = require("${below.name}");\n`) +
        (belowAtLoad ? `const atLoad = ${below.call("below")};\n` : "")
      : "";
    const folder = `node_modules/${name}/`;
    const up = inner ? "../" : "./";
    const own =
      reads === "require"
        ? `const own = require("${up}package.json");\n`
        : reads === "createRequire"
          ? `import { createRequire } from "node:module";\nconst own = createRequire(import.meta.url)("${up}package.json");\n`
          : reads === "json import"
            ? `import own from "${up}package.json" with { type: "json" };\n`
            : `const own = { version: "none" };\n`;
    const main = isModule
      ? `${head}${own}const made = ${value};\nexport default made;\nexport const version = own.version;\nexport function neverCalledInside() { return "${name} from outside"; }\n`
      : `${head}${own}const made = ${value};\nmodule.exports = made;\nmodule.exports.version = own.version;\nmodule.exports.neverCalledInside = function () { return "${name} from outside"; };\n`;
    if (inner) {
      project.files.set(folder + "lib/main.js", main);
      project.files.set(
        folder + "index.js",
        isModule
          ? `export { default } from "./lib/main.js";\nexport * from "./lib/main.js";\n`
          : `module.exports = require("./lib/main.js");\n`,
      );
    } else project.files.set(folder + "index.js", main);
    project.files.set(
      folder + "package.json",
      JSON.stringify({
        name,
        version: `${n}.1.0`,
        ...(isModule ? { type: "module" } : {}),
        ...(project.chance(40)
          ? { exports: project.chance(50) ? "./index.js" : { ".": "./index.js", "./package.json": "./package.json" } }
          : { main: "index.js" }),
        ...(project.chance(30) ? { sideEffects: false } : {}),
      }) + "\n",
    );
    packages.push({ name, isModule, call });
  }
  const files = 1 + project.below(4);
  for (let m = 0; m < files; m++) {
    const used = project
      .several(1, 3, () => project.below(packages.length))
      .filter((at, index, all) => all.indexOf(at) === index);
    const atLoad = project.chance(60);
    const values = used.flatMap(at => [
      packages[at].call(`p${at}`),
      ...(project.chance(50) ? [`n${at}.version`] : []),
      ...(project.chance(35) ? [`n${at}.neverCalledInside()`] : []),
    ]);
    const name = `helpers/made-${m}.${project.chance(25) ? "ts" : "js"}`;
    project.files.set(
      name,
      (name.endsWith(".ts") ? "// @ts-nocheck\n" : "") +
        used
          .map(at => `import p${at} from "${packages[at].name}";\nimport * as n${at} from "${packages[at].name}";\n`)
          .join("") +
        (m > 0 && project.chance(40)
          ? `export * as before from "./${project.made[project.below(m)].split("/")[1]}";\n`
          : "") +
        (atLoad
          ? `export const made = [${values.join(", ")}];\n`
          : `export const make = () => [${values.join(", ")}];\n`),
    );
    project.made.push(name);
  }
}

function writeHelpers(project: Project) {
  writeDrawnPackages(project);
  project.files.set("package.json", `{ "name": "drawn", "type": "module" }\n`);
  project.files.set(
    "tsconfig.json",
    `{ "compilerOptions": { "strict": true, "allowImportingTsExtensions": true, "noEmit": true, "resolveJsonModule": true, "baseUrl": ".", "paths": { "@helpers/*": ["./helpers/*"] } } }\n`,
  );
  project.files.set(
    "helpers/script.js",
    `console.log("the script ran", process.argv.slice(2).join(), process.env.FROM_THE_TEST ?? "no variable");\n`,
  );
  project.files.set("helpers/data.json", `{ "value": ${project.below(9)}, "list": [1, 2, 3] }\n`);
  project.files.set("helpers/words.txt", "some words\n");
  project.files.set("helpers/unrelated.js", "export const unrelated = 1;\n");
  project.files.set("helpers/copied-inner.js", `export const inner = "inner";\nexport function f() { return "f"; }\n`);
  for (const [which, text] of [
    ["star", `export * from "./resolved-inner-star.js";\n`],
    ["named", `export { inner } from "./resolved-inner-named.js";\n`],
    ["namespace", `export * as one from "./resolved-inner-namespace.js";\n`],
    ["uses", `import { inner } from "./resolved-inner-uses.js";\nexport const mine = inner + "!";\n`],
  ]) {
    project.files.set(`helpers/resolved-inner-${which}.js`, `export const inner = "inner of ${which}";\n`);
    project.files.set(`helpers/from-disk-${which}.js`, text);
  }
  project.files.set("helpers/copied-inner.cjs", `exports.inner = "inner";\nexports.f = () => "f";\n`);
  project.files.set("helpers/copied-star.js", `export * from "./copied-inner.js";\n`);
  project.files.set("helpers/copied-named.js", `export { inner } from "./copied-inner.js";\n`);
  project.files.set("helpers/copied-namespace.js", `export * as one from "./copied-inner.js";\n`);
  project.files.set(
    "helpers/copied-uses.js",
    `import { inner, f } from "./copied-inner.js";\nexport const mine = inner + "!";\nexport { f };\n`,
  );
  project.files.set(
    "helpers/copied-requires.cjs",
    `const { inner, f } = require("./copied-inner.cjs");\nmodule.exports = { mine: inner + "?", f };\n`,
  );
  project.files.set("helpers/evicted.js", "export let count = 0;\nexport const bump = () => ++count;\n");
  project.files.set("helpers/evicted.cjs", "let n = 0;\nexports.bump = () => ++n;\nexports.read = () => n;\n");
  project.files.set(
    "helpers/imports-evicted.js",
    `import { bump, count } from "./evicted.js";\nexport const seenWhenLoaded = count;\nexport const next = () => bump();\n`,
  );
  project.files.set(
    "helpers/late.js",
    `import { add } from "./math.ts";
import { bump, count } from "./state.js";
import { greet } from "tiny-pkg";
export const seenWhenLoaded = [typeof add, count, greet("l")].join();
export const sum = (a, b) => add(a, b);
export const next = () => bump();
export const hello = () => greet("late");
`,
  );
  project.files.set(
    "helpers/typed.ts",
    `export enum Level { Low, Middle, High }
export enum Names { First = "first", Second = "second" }
export function describeLevel(level: Level): string { switch (level) { case Level.Low: return "low"; case Level.Middle: return "middle"; case Level.High: return "high"; default: return "none: " + level; } }
export abstract class Base { abstract name(): string; hello(): string { return "hello " + this.name(); } }
export class Kept extends Base { static count = 0; readonly #held: number[]; constructor(public readonly size: number) { super(); this.#held = Array.from({ length: size }, (_, at) => at); Kept.count++; } name(): string { return "kept " + this.#held.length; } static is(value: unknown): value is Kept { return typeof value === "object" && value !== null && #held in value; } }
export const isKept = (value: unknown): boolean => Kept.is(value);
`,
  );
  project.files.set(
    "helpers/state.js",
    `export let count = 0;
export function bump() { return ++count; }
export const table = { name: "table", rows: [] };
export function size() { return table.rows.length; }
globalThis.loadsOfState = (globalThis.loadsOfState ?? 0) + 1;
export const loadedAs = globalThis.loadsOfState;
`,
  );
  project.files.set(
    "helpers/math.ts",
    `export function add(a: number, b: number): number { return a + b; }
export function twice(x: number): number { return add(x, x); }
export const thrice = (x: number): number => add(twice(x), x);
export default function scale(x: number, by = 2): number { return x * by; }
`,
  );
  project.files.set(
    "helpers/counters.ts",
    `export class Counter {
  value = 0;
  static made = 0;
  step: number;
  constructor(step = 1) { this.step = step; Counter.made++; }
  next(): number { this.value += this.step; return this.value; }
  get double(): number { return this.value * 2; }
  twoSteps(): number { this.next(); return this.next(); }
  static reset(): void { Counter.made = 0; }
}
export const shared = new Counter(5);
export function make(step: number): Counter { return new Counter(step); }
`,
  );
  project.files.set(
    "helpers/plain.cjs",
    `let count = 0;
exports.bump = () => ++count;
exports.read = () => count;
exports.list = [1, 2, 3];
exports.name = "plain";
`,
  );
  project.files.set(
    "helpers/uses.js",
    `import { bump } from "./state.js";
import { add, twice } from "./math.ts";
import { shared } from "./counters.ts";
export function both(x) { return add(bump(), x); }
export function doubled(x) { return twice(x) + 1; }
export function stepped() { return shared.next(); }
`,
  );
  project.files.set(
    "helpers/builtins.js",
    `export const largest = (...all) => Math.max(...all);
export const now = () => Date.now();
export const keys = object => Object.keys(object).join();
export const text = value => JSON.stringify(value);
export const upper = word => word.toUpperCase();
export const mapped = list => list.map(each => each * 2);
export const whole = word => parseInt(word, 10);
export const isWhole = value => Number.isInteger(value);
export const drawn = () => Math.random();
export const joined = list => list.join("-");
export const year = () => new Date().getFullYear();
`,
  );
  project.files.set(
    "helpers/nodes.ts",
    `import * as path from "node:path";
import { existsSync } from "node:fs";
import os from "node:os";
export const base = (file: string): string => path.basename(file);
export const isThere = (file: string): boolean => existsSync(file);
export const endOfLine = (): string => JSON.stringify(os.EOL);
`,
  );
  project.files.set(
    "helpers/shapes.ts",
    `export interface Shape { kind: string; area(): number; }
export class Square implements Shape {
  kind = "square";
  side: number;
  constructor(side: number) { this.side = side; }
  area(): number { return this.side * this.side; }
  describe(): string { return this.kind + " " + this.area(); }
}
export class Circle implements Shape {
  kind = "circle";
  radius: number;
  constructor(radius: number) { this.radius = radius; }
  area(): number { return 3 * this.radius * this.radius; }
  describe(): string { return this.kind + " " + this.area(); }
}
export function total(all: Shape[]): number { let sum = 0; for (const shape of all) sum += shape.area(); return sum; }
export function label(shape: Shape): string { return shape.kind.toUpperCase() + ":" + shape.area().toFixed(1); }
export const registry = new Map<string, Shape>();
export function register(shape: Shape): number { registry.set(shape.kind, shape); return registry.size; }
`,
  );
  project.files.set(
    "helpers/again.ts",
    `export * from "./math.ts";\nexport { bump as increase, table } from "./state.js";\n`,
  );
  project.files.set(
    "node_modules/tiny-pkg/package.json",
    `{ "name": "tiny-pkg", "version": "1.0.0", "type": "module", "main": "index.js" }\n`,
  );
  project.files.set(
    "node_modules/tiny-pkg/index.js",
    `export function greet(name) { return "hello " + name; }\nexport const version = "1.0.0";\nexport default { greet };\n`,
  );
  project.files.set(
    "node_modules/old-pkg/package.json",
    `{ "name": "old-pkg", "version": "1.0.0", "main": "index.js" }\n`,
  );
  project.files.set(
    "node_modules/old-pkg/index.js",
    `module.exports = { shout: word => word.toUpperCase() + "!", level: 3 };\n`,
  );
  project.files.set(
    "helpers/packages.js",
    `import { greet, version } from "tiny-pkg";
import old from "old-pkg";
export const welcome = name => greet(name) + " " + old.shout("x") + " " + version;
export const level = () => old.level;
`,
  );
  if (project.chance(35)) {
    project.files.set("bunfig.toml", `[test]\npreload = ["./setup.ts"]\n`);
    project.files.set(
      "setup.ts",
      `import { afterEach, beforeEach, mock } from "bun:test";
const world = globalThis as any;
world.fromThePreload = { value: ${project.below(9)}, calls: 0 };
beforeEach(() => { world.fromThePreload.calls++; });
afterEach(() => { world.fromThePreload.last = world.fromThePreload.calls; });
${project.chance(40) ? `mock.module("tiny-pkg", () => ({ greet: () => "mocked in the preload", version: "0", default: {} }));` : ""}
${project.chance(25) ? `const realMax = Math.max; Math.max = (...all: number[]) => realMax(...all, 1000);` : ""}
`,
    );
  }
  project.files.set(
    "helpers/worker.js",
    `import { bump } from "./state.js";
import { twice } from "./math.ts";
self.onmessage = event => { postMessage({ got: event.data, bumped: bump(), twice: twice(event.data), max: Math.max(1, 2) }); };
`,
  );
}

/**
 * Modules that import one another, some in a circle. Each writes down when it begins and ends and what it sees of the others then; each holds a variable that the others read through its binding.
 * Under --isolate every test file gets them anew, evaluated in the same order.
 */
function writeGraph(project: Project) {
  const count = 3 + project.below(8);
  const nameOf = (index: number) => `m${index}.${index % 3 === 2 ? "ts" : "js"}`;
  for (let index = 0; index < count; index++) {
    const isTypeScript = nameOf(index).endsWith(".ts");
    const others = Array.from({ length: count }, (_, other) => other).filter(
      other => other !== index && project.chance(other > index ? 35 : 8),
    );
    const order = `(globalThis${isTypeScript ? " as any" : ""}).order`;
    project.files.set(
      `graph/${nameOf(index)}`,
      [
        ...others.map(other => `import { get${other}, value${other} } from "./${nameOf(other)}";`),
        ...(project.chance(15) && index + 1 < count ? [`export * from "./${nameOf(index + 1)}";`] : []),
        `(${order} ??= []).push("m${index} begins");`,
        `export let value${index}${isTypeScript ? ": number" : ""} = ${index * 10};`,
        `export function get${index}(depth${isTypeScript ? ": number" : ""} = 0)${isTypeScript ? ": number" : ""} { return depth > 2 ? value${index} : value${index}${others.map(other => ` + get${other}(depth + 1)`).join("")}; }`,
        `export function set${index}(value${isTypeScript ? ": number" : ""}) { value${index} = value; }`,
        ...others.map(
          other =>
            `try { ${order}.push("m${index} sees " + value${other}); } catch (error) { ${order}.push("m${index} finds m${other} in its dead zone"); }`,
        ),
        ...(project.chance(15)
          ? [`await ${project.pick(["null", "Promise.resolve()", "new Promise(resolve => setTimeout(resolve, 1))"])};`]
          : []),
        ...(project.chance(20) ? [`value${index} += 1;`] : []),
        `${order}.push("m${index} ends");`,
        "",
      ].join("\n"),
    );
  }
  return { count, nameOf };
}

/** [how it is reached, the name, what replaces it, what the test file asks, what a helper asks] */
const replaceable: [string, string, string, string, string][] = [
  ["Math", "max", "() => 7", "Math.max(1, 2)", "builtins.largest(1, 2)"],
  ["Date", "now", "() => 1234", "Date.now()", "builtins.now()"],
  ["Object", "keys", '() => ["replaced"]', "Object.keys({ a: 1 }).join()", "builtins.keys({ a: 1 })"],
  ["JSON", "stringify", '() => "replaced"', "JSON.stringify([1])", "builtins.text([1])"],
  ["String.prototype", "toUpperCase", 'function () { return "UP"; }', '"a".toUpperCase()', 'builtins.upper("a")'],
  ["Array.prototype", "map", 'function () { return ["replaced"]; }', "[1].map(each => each)", "builtins.mapped([1])"],
  ["Array.prototype", "join", 'function () { return "replaced"; }', "[1, 2].join()", "builtins.joined([1, 2])"],
  ["globalThis", "parseInt", "() => 42", 'parseInt("1", 10)', 'builtins.whole("1")'],
  ["Number", "isInteger", '() => "replaced"', "Number.isInteger(1)", "builtins.isWhole(1)"],
  ["Math", "random", "() => 0.5", "Math.random()", "builtins.drawn()"],
];

type Drawn = {
  kind: string;
  lines: string[];
  isAsync?: boolean;
  options?: string;
  imports?: string[];
  needs: (keyof typeof helpers)[];
  around?: [string, string];
};

/** What Bun's own library makes for a realm or implements: each is touched by a test file itself. A build in several images may hold several copies of that library code. */
const realmThings: [string, string][] = [
  ["process.stdout.write", 'process.stdout.write("")'],
  ["process.stderr.write", 'process.stderr.write("")'],
  ["process.stdin", "typeof process.stdin.on"],
  [
    "process.stdout fields",
    "[typeof process.stdout.isTTY, typeof process.stdout.fd, process.stdout.writable, typeof process.stdout.on]",
  ],
  ["process.stderr fields", "[process.stderr.fd, process.stderr.writable, typeof process.stderr.once]"],
  ["process.stdout.on", '(process.stdout.on("drain", () => {}), process.stdout.listenerCount("drain") > 0)'],
  ["process.stdout.cork", "(process.stdout.cork(), process.stdout.uncork(), 1)"],
  ["process.nextTick", 'new Promise(r => process.nextTick(r, "ticked"))'],
  ["process.on and emit", '(() => { let n = 0; process.once("mine", () => n++); process.emit("mine"); return n; })()'],
  ["process.hrtime", "[typeof process.hrtime()[0], typeof process.hrtime.bigint()]"],
  ["process.memoryUsage", "[typeof process.memoryUsage().rss, typeof process.memoryUsage.rss()]"],
  ["process.cpuUsage", "typeof process.cpuUsage().user"],
  ["process.resourceUsage", "typeof process.resourceUsage().maxRSS"],
  [
    "process small",
    "[typeof process.cwd(), typeof process.pid, typeof process.ppid, typeof process.title, typeof process.uptime(), typeof process.umask(), process.platform, typeof process.arch]",
  ],
  [
    "process tables",
    "[typeof process.versions.bun, typeof process.release.name, typeof process.config.variables, typeof process.features, typeof process.execArgv.length, typeof process.argv0]",
  ],
  ["process.getBuiltinModule", 'typeof process.getBuiltinModule("fs").readFileSync'],
  ["process.binding", '(() => { try { return typeof process.binding("util"); } catch (e) { return e.name; } })()'],
  ["process.report", "typeof process.report?.getReport"],
  ["process.allowedNodeEnvironmentFlags", "typeof process.allowedNodeEnvironmentFlags?.has"],
  ["process.kill 0", "process.kill(process.pid, 0)"],
  ["process.env", '(process.env.SET_FOR_A_MOMENT = "1", delete process.env.SET_FOR_A_MOMENT, typeof process.env.PATH)'],
  ["process.channel", "typeof process.channel"],
  ["process.constrainedMemory", "typeof process.constrainedMemory()"],
  ["process.getuid", "typeof process.getuid()"],
  ["console.log", '(console.log(""), 1)'],
  ["console.table", "(console.table([{ a: 1 }]), 1)"],
  ["console.group", '(console.group("g"), console.groupEnd(), 1)'],
  ["console.time", '(console.time("t"), console.timeEnd("t"), 1)'],
  ["console.Console", '(new console.Console(process.stdout, process.stderr).log(""), 1)'],
  ["console.write", '(console.write?.(""), 1)'],
  ["console iterator", "typeof console[Symbol.asyncIterator]"],
  ["console.dir trace count assert", '(console.dir({ a: 1 }), console.count("c"), console.assert(true), 1)'],
  [
    "setTimeout",
    "new Promise(r => { const t = setTimeout(() => r([typeof t.ref, typeof t.unref, typeof t.refresh, typeof t.hasRef(), typeof t[Symbol.toPrimitive]()]), 1); })",
  ],
  ["setInterval", 'new Promise(r => { const t = setInterval(() => { clearInterval(t); r("fired"); }, 1); })'],
  ["setImmediate", "new Promise(r => { const t = setImmediate(() => r(typeof t.ref)); })"],
  ["queueMicrotask", 'new Promise(r => queueMicrotask(() => r("ran")))'],
  ["Bun.sleep", 'Bun.sleep(1).then(() => "slept")'],
  ["structuredClone", "structuredClone({ a: [1, new Map([[1, 2]])] }).a[1].get(1)"],
  [
    "ReadableStream",
    'new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode("rs")); c.close(); } })).text()',
  ],
  [
    "ReadableStream reader",
    "(async () => { const r = new ReadableStream({ pull(c) { c.enqueue(1); c.close(); } }).getReader(); return [(await r.read()).value, (await r.read()).done]; })()",
  ],
  [
    "ReadableStream for await",
    "(async () => { const out = []; for await (const x of new ReadableStream({ start(c) { c.enqueue(1); c.enqueue(2); c.close(); } })) out.push(x); return out; })()",
  ],
  [
    "ReadableStream tee and pipe",
    '(async () => { const [a, b] = new ReadableStream({ start(c) { c.enqueue("x"); c.close(); } }).tee(); const got = []; await a.pipeTo(new WritableStream({ write(x) { got.push(x); } })); return [got, (await b.getReader().read()).value]; })()',
  ],
  [
    "ReadableStream bytes",
    '(async () => (await new ReadableStream({ type: "bytes", start(c) { c.enqueue(new Uint8Array([1])); c.close(); } }).getReader().read()).value[0])()',
  ],
  [
    "ReadableStream direct",
    'new Response(new ReadableStream({ type: "direct", pull(c) { c.write("direct"); c.close(); } })).text()',
  ],
  [
    "WritableStream",
    "(async () => { const got = []; const w = new WritableStream({ write(x) { got.push(x); } }).getWriter(); await w.write(1); await w.close(); return got; })()",
  ],
  [
    "TransformStream",
    "(async () => { const t = new TransformStream({ transform(x, c) { c.enqueue(x * 2); } }); const w = t.writable.getWriter(); w.write(2); w.close(); return (await t.readable.getReader().read()).value; })()",
  ],
  [
    "TextDecoderStream",
    "(async () => { const t = new TextDecoderStream(); const w = t.writable.getWriter(); w.write(new Uint8Array([104, 105])); w.close(); return (await t.readable.getReader().read()).value; })()",
  ],
  [
    "CompressionStream",
    '(async () => typeof (await new Response(new Blob(["abc"]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer()).byteLength)()',
  ],
  [
    "queuing strategies",
    "[new CountQueuingStrategy({ highWaterMark: 2 }).highWaterMark, new ByteLengthQueuingStrategy({ highWaterMark: 3 }).size(new Uint8Array(4))]",
  ],
  [
    "Response and Request",
    '(async () => [await new Response("r").text(), (await new Request("http://x/", { method: "POST", body: "q" }).text()), Response.json({ a: 1 }).headers.get("content-type")])()',
  ],
  ["Response.body", '(async () => (await new Response("body").body.getReader().read()).value.length)()'],
  ["Headers", '[...new Headers({ a: "1", b: "2" })]'],
  [
    "FormData",
    '(() => { const f = new FormData(); f.append("a", "1"); f.append("b", new Blob(["x"]), "n.txt"); return [...f.keys()]; })()',
  ],
  [
    "Blob and File",
    '(async () => [await new Blob(["a", "b"]).text(), new File(["x"], "n").name, (await new Blob(["s"]).stream().getReader().read()).value.length, (await new Blob(["ab"]).slice(1).text())])()',
  ],
  [
    "URL",
    '[new URL("http://a/b?c=1#d").searchParams.get("c"), [...new URLSearchParams("a=1&b=2")].length, URL.canParse("x")]',
  ],
  [
    "TextEncoder",
    '[new TextEncoder().encode("\u00e9").length, new TextDecoder().decode(new Uint8Array([104])), new TextEncoder().encodeInto("a", new Uint8Array(2)).written]',
  ],
  [
    "AbortController",
    '(() => { const c = new AbortController(); let n = 0; c.signal.addEventListener("abort", () => n++); c.abort("why"); return [n, c.signal.reason, AbortSignal.abort().aborted, typeof AbortSignal.timeout(1000), AbortSignal.any([c.signal]).aborted]; })()',
  ],
  [
    "EventTarget",
    '(() => { const t = new EventTarget(); let got; t.addEventListener("e", e => { got = [e.type, e.detail]; }); t.dispatchEvent(new CustomEvent("e", { detail: 5 })); return got; })()',
  ],
  [
    "MessageChannel",
    'new Promise(r => { const c = new MessageChannel(); c.port1.onmessage = e => { c.port1.close(); r(e.data); }; c.port2.postMessage("over"); })',
  ],
  ["BroadcastChannel", '(() => { const b = new BroadcastChannel("k"); b.close(); return b.name; })()'],
  [
    "performance",
    '[typeof performance.now(), typeof performance.timeOrigin, performance.mark("m").name, performance.measure("x", "m").name, performance.getEntriesByName("m").length, typeof performance.toJSON]',
  ],
  [
    "crypto",
    '(async () => [crypto.randomUUID().length, crypto.getRandomValues(new Uint8Array(2)).length, (await crypto.subtle.digest("SHA-1", new Uint8Array(1))).byteLength, typeof crypto.timingSafeEqual])()',
  ],
  ["fetch of data", 'fetch("data:text/plain,hi").then(r => r.text())'],
  ["navigator", "[typeof navigator.userAgent, typeof navigator.hardwareConcurrency]"],
  ["atob btoa", '[btoa("a"), atob("YQ==")]'],
  ["DOMException", '[new DOMException("m", "AbortError").code, new DOMException("m") instanceof Error]'],
  ["WebSocket", "[typeof WebSocket, WebSocket.OPEN]"],
  ["Worker type", "typeof Worker"],
  [
    "Bun.file",
    '(async () => [await Bun.file(import.meta.dir + "/package.json").text().then(t => t.length > 0), Bun.file("/nope").size, await Bun.file("/nope").exists(), typeof Bun.file(import.meta.dir + "/package.json").stream])()',
  ],
  [
    "Bun.file stream",
    '(async () => (await Bun.file(import.meta.dir + "/package.json").stream().getReader().read()).value.length > 0)()',
  ],
  [
    "Bun.file writer",
    '(async () => { const p = process.env.SEEN_IN + "/w-" + process.pid + ".txt"; const w = Bun.file(p).writer(); w.write("ab"); await w.end(); return Bun.file(p).text(); })()',
  ],
  [
    "Bun.write",
    '(async () => { const p = process.env.SEEN_IN + "/x-" + process.pid + ".txt"; return [await Bun.write(p, "abc"), await Bun.file(p).text()]; })()',
  ],
  ["Bun.stdout stderr stdin", "[typeof Bun.stdout.size, typeof Bun.stderr.writer, typeof Bun.stdin.stream]"],
  ["Bun.write to Bun.stdout", 'Bun.write(Bun.stdout, "")'],
  ["Bun.spawnSync", 'Bun.spawnSync(["echo", "hi"]).stdout.toString()'],
  [
    "Bun.spawn",
    '(async () => { const p = Bun.spawn(["echo", "hi"]); return [await new Response(p.stdout).text(), await p.exited]; })()',
  ],
  [
    "Bun.spawn stdin pipe",
    '(async () => { const p = Bun.spawn(["cat"], { stdin: "pipe" }); p.stdin.write("in"); p.stdin.end(); return new Response(p.stdout).text(); })()',
  ],
  ["Bun.$", "Bun.$`echo shell`.text()"],
  [
    "Bun.serve",
    '(async () => { const s = Bun.serve({ port: 0, fetch: () => new Response("served") }); try { return await (await fetch(s.url)).text(); } finally { s.stop(true); } })()',
  ],
  [
    "Bun.listen",
    '(() => { const s = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } }); const p = typeof s.port; s.stop(true); return p; })()',
  ],
  ["Bun.inspect", "[Bun.inspect({ a: [1, new Map()] }), Bun.inspect.custom.toString(), typeof Bun.inspect.table]"],
  [
    "Bun small",
    '[Bun.deepEquals({ a: 1 }, { a: 1 }), typeof Bun.hash("a"), typeof Bun.nanoseconds(), typeof Bun.which("ls"), Bun.stringWidth("ab"), Bun.escapeHTML("<"), Bun.fileURLToPath("file:///a"), Bun.pathToFileURL("/a").href, typeof Bun.version, typeof Bun.revision, Bun.peek(Promise.resolve(1)), typeof Bun.env.PATH, typeof Bun.argv.length, Bun.semver.satisfies("1.2.3", "^1"), Bun.color("red", "hex")]',
  ],
  [
    "Bun compression",
    '[Bun.gunzipSync(Bun.gzipSync("abc")).length, Bun.inflateSync(Bun.deflateSync("abc")).length, typeof Bun.zstdCompressSync]',
  ],
  ["Bun.password", 'Bun.password.hash("p", { algorithm: "bcrypt", cost: 4 }).then(h => Bun.password.verify("p", h))'],
  ["Bun.Glob", '[new Bun.Glob("*.json").match("a.json"), [...new Bun.Glob("package.json").scanSync(import.meta.dir)]]'],
  [
    "Bun.Transpiler",
    'new Bun.Transpiler({ loader: "ts" }).transformSync("const a: number = 1; export { a };").includes("a = 1")',
  ],
  [
    "Bun.CryptoHasher",
    '[new Bun.CryptoHasher("sha1").update("a").digest("hex").length, Bun.SHA1.hash("a", "hex").length, Bun.CryptoHasher.algorithms.length > 3]',
  ],
  [
    "Bun stream readers",
    '(async () => [await Bun.readableStreamToText(new Blob(["t"]).stream()), (await Bun.readableStreamToArray(new Blob(["t"]).stream())).length, (await Bun.readableStreamToBytes(new Blob(["t"]).stream())).length, await Bun.readableStreamToJSON(new Blob(["1"]).stream())])()',
  ],
  [
    "Bun.ArrayBufferSink",
    '(() => { const s = new Bun.ArrayBufferSink(); s.start({}); s.write("ab"); return s.end().byteLength; })()',
  ],
  ["Bun.TOML", 'Bun.TOML.parse("a = 1")'],
  ["Bun.gc and jsc", '[typeof Bun.gc(false), typeof require("bun:jsc").heapSize()]'],
  ["Bun.resolveSync", 'Bun.resolveSync("./package.json", import.meta.dir).split("/").at(-1)'],
  ["Bun.randomUUIDv7", "Bun.randomUUIDv7().length"],
  ["Bun.dns", "typeof Bun.dns.lookup"],
  ["Bun.mmap", 'Bun.mmap(import.meta.dir + "/package.json").length > 0'],
  ["Bun.plugin type", "typeof Bun.plugin"],
  ["Bun.indexOfLine", "Bun.indexOfLine(new Uint8Array([97, 10]), 0)"],
  ["Bun.concatArrayBuffers", "Bun.concatArrayBuffers([new Uint8Array(1), new Uint8Array(2)]).byteLength"],
  ["Bun.stripANSI", "typeof Bun.stripANSI"],
  ["Bun.Cookie", "typeof Bun.Cookie"],
  [
    "HTMLRewriter",
    'new HTMLRewriter().on("a", { element(e) { e.setAttribute("x", "1"); } }).transform(new Response("<a></a>")).text()',
  ],
  [
    "bun:sqlite",
    '(() => { const { Database } = require("bun:sqlite"); const d = new Database(":memory:"); d.run("create table t (a)"); d.run("insert into t values (1)"); const r = d.query("select a from t").all(); d.close(); return r; })()',
  ],
  ["bun:ffi", 'typeof require("bun:ffi").dlopen'],
  [
    "events",
    '(() => { const { EventEmitter, once } = require("node:events"); const e = new EventEmitter(); let n = 0; e.on("x", v => (n += v)); e.emit("x", 2); return [n, e.listenerCount("x"), typeof once, EventEmitter.defaultMaxListeners]; })()',
  ],
  [
    "events once and on",
    '(async () => { const { EventEmitter, once } = require("node:events"); const e = new EventEmitter(); setTimeout(() => e.emit("x", 5), 1); return once(e, "x"); })()',
  ],
  [
    "events class",
    '(() => { const E = require("node:events"); class M extends E { constructor() { super(); this.m = 1; } } const m = new M(); let g; m.once("a", function () { g = this === m; }); m.emit("a"); return [g, m instanceof E]; })()',
  ],
  [
    "stream Readable",
    '(async () => { const { Readable } = require("node:stream"); const out = []; for await (const x of Readable.from(["a", "b"])) out.push(x); return out; })()',
  ],
  [
    "stream pipeline",
    '(async () => { const { Readable, Writable, Transform } = require("node:stream"); const { pipeline } = require("node:stream/promises"); const got = []; await pipeline(Readable.from(["a"]), new Transform({ transform(c, e, cb) { cb(null, String(c).toUpperCase()); } }), new Writable({ write(c, e, cb) { got.push(String(c)); cb(); } })); return got; })()',
  ],
  [
    "stream PassThrough",
    'new Promise(r => { const { PassThrough } = require("node:stream"); const p = new PassThrough(); p.on("data", d => r(String(d))); p.end("pt"); })',
  ],
  [
    "stream Duplex and web",
    '(() => { const { Duplex, Readable } = require("node:stream"); return [typeof Duplex.from, typeof Readable.toWeb(Readable.from(["a"])).getReader, typeof Readable.fromWeb]; })()',
  ],
  ["stream/consumers", 'require("node:stream/consumers").text(require("node:stream").Readable.from(["c"]))'],
  ["stream/web", 'typeof require("node:stream/web").ReadableStream'],
  [
    "fs sync",
    '(() => { const fs = require("node:fs"); return [fs.readFileSync(import.meta.dir + "/package.json", "utf8").length > 0, fs.existsSync("/nope"), fs.statSync(import.meta.dir).isDirectory(), fs.readdirSync(import.meta.dir).includes("package.json")]; })()',
  ],
  [
    "fs promises",
    'require("node:fs/promises").readFile(import.meta.dir + "/package.json", "utf8").then(t => t.length > 0)',
  ],
  [
    "fs callback",
    'new Promise(r => require("node:fs").readFile(import.meta.dir + "/package.json", (e, d) => r([e, d.length > 0])))',
  ],
  [
    "fs createReadStream",
    'new Promise(r => { let n = 0; require("node:fs").createReadStream(import.meta.dir + "/package.json").on("data", d => (n += d.length)).on("end", () => r(n > 0)); })',
  ],
  [
    "fs createWriteStream",
    'new Promise(r => { const p = process.env.SEEN_IN + "/s-" + process.pid + ".txt"; const w = require("node:fs").createWriteStream(p); w.end("ws", () => r(require("node:fs").readFileSync(p, "utf8"))); })',
  ],
  [
    "fs watch type and Dirent",
    '(() => { const fs = require("node:fs"); return [typeof fs.watch, fs.readdirSync(import.meta.dir, { withFileTypes: true })[0].constructor.name, typeof fs.opendirSync, typeof fs.constants.O_RDONLY]; })()',
  ],
  [
    "fs filehandle",
    '(async () => { const h = await require("node:fs/promises").open(import.meta.dir + "/package.json"); try { return (await h.read(Buffer.alloc(1), 0, 1, 0)).bytesRead; } finally { await h.close(); } })()',
  ],
  [
    "path",
    '(() => { const p = require("node:path"); return [p.join("a", "b"), p.basename("/a/b.c", ".c"), p.posix.sep, p.win32.sep, p.parse("/a/b.c").name, p.relative("/a", "/a/b")]; })()',
  ],
  [
    "os",
    '(() => { const o = require("node:os"); return [typeof o.cpus().length, o.EOL, typeof o.tmpdir(), typeof o.hostname(), typeof o.userInfo().username, typeof o.networkInterfaces(), typeof o.constants.signals.SIGINT]; })()',
  ],
  [
    "util.inspect",
    '(() => { const u = require("node:util"); return [u.inspect({ a: { b: { c: {} } } }), u.inspect(new Map([[1, 2]])), u.inspect("s", { colors: true }), typeof u.inspect.custom]; })()',
  ],
  ["util.format", 'require("node:util").format("%s %d %j %o", "a", 1, { b: 2 }, [3])'],
  ["util.promisify", 'require("node:util").promisify((a, cb) => cb(null, a + 1))(1)'],
  [
    "util more",
    '(() => { const u = require("node:util"); return [u.types.isPromise(Promise.resolve()), u.isDeepStrictEqual([1], [1]), u.parseArgs({ args: ["-a"], options: { a: { type: "boolean", short: "a" } } }).values.a, typeof u.styleText, u.stripVTControlCharacters("a"), typeof u.deprecate(() => {}, "d"), typeof u.callbackify, new u.TextDecoder().encoding, u.inherits.length, typeof u.debuglog("x"), typeof u.getSystemErrorName]; })()',
  ],
  [
    "buffer",
    '(() => { const { Buffer: B, constants, Blob: Bl } = require("node:buffer"); return [B.from("ab").toString("hex"), B.concat([B.alloc(1), B.from([2])]).length, B.byteLength("\u00e9"), B.isBuffer(B.alloc(0)), typeof constants.MAX_LENGTH, B.from("YQ==", "base64").toString(), B.alloc(2).fill(1).readUInt16LE(0), typeof Bl, B.from("a").equals(B.from("a")), B.poolSize]; })()',
  ],
  [
    "Buffer global",
    '[Buffer.from("x").toJSON(), Buffer.from([1, 2, 3]).subarray(1).length, Buffer.compare(Buffer.from("a"), Buffer.from("b")), Buffer.from("abc").indexOf("c"), Buffer.from("a").inspect?.()]',
  ],
  ["child_process spawnSync", 'String(require("node:child_process").spawnSync("echo", ["cp"]).stdout)'],
  ["child_process execSync", 'String(require("node:child_process").execSync("echo ex"))'],
  [
    "child_process spawn",
    'new Promise(r => { let o = ""; const c = require("node:child_process").spawn("echo", ["sp"]); c.stdout.on("data", d => (o += d)); c.on("close", code => r([o, code])); })',
  ],
  ["child_process exec", 'new Promise(r => require("node:child_process").exec("echo e", (e, so) => r([e, so])))'],
  [
    "child_process execFile",
    'require("node:util").promisify(require("node:child_process").execFile)("echo", ["ef"]).then(x => x.stdout)',
  ],
  [
    "node crypto",
    '(() => { const c = require("node:crypto"); return [c.createHash("sha1").update("a").digest("hex").length, c.randomBytes(2).length, c.createHmac("sha1", "k").update("a").digest("hex").length, c.randomUUID().length, typeof c.webcrypto.subtle, c.getHashes().length > 3, c.timingSafeEqual(Buffer.from("a"), Buffer.from("a")), c.randomInt(1)]; })()',
  ],
  [
    "node crypto cipher",
    '(() => { const c = require("node:crypto"); const k = Buffer.alloc(16), iv = Buffer.alloc(16); const e = c.createCipheriv("aes-128-cbc", k, iv); const x = Buffer.concat([e.update("abc"), e.final()]); const d = c.createDecipheriv("aes-128-cbc", k, iv); return Buffer.concat([d.update(x), d.final()]).toString(); })()',
  ],
  [
    "node crypto async",
    'new Promise(r => require("node:crypto").pbkdf2("p", "s", 1, 4, "sha1", (e, k) => r(k.length)))',
  ],
  [
    "node crypto hash stream",
    'new Promise(r => { const h = require("node:crypto").createHash("sha1"); h.on("readable", () => { const d = h.read(); if (d) r(d.length); }); h.end("a"); })',
  ],
  [
    "http server",
    'new Promise(r => { const http = require("node:http"); const s = http.createServer((q, a) => a.end("http")).listen(0, "127.0.0.1", () => http.get({ port: s.address().port, host: "127.0.0.1" }, x => { let o = ""; x.on("data", d => (o += d)); x.on("end", () => { s.close(); r([o, x.statusCode]); }); })); })',
  ],
  [
    "http tables",
    '(() => { const h = require("node:http"); return [h.STATUS_CODES[404], h.METHODS.includes("GET"), typeof h.Agent, typeof h.globalAgent.maxSockets, typeof h.IncomingMessage, typeof h.ServerResponse]; })()',
  ],
  [
    "https http2 tls",
    '[typeof require("node:https").request, typeof require("node:http2").connect, typeof require("node:tls").connect, typeof require("node:tls").rootCertificates.length]',
  ],
  [
    "net",
    'new Promise(r => { const net = require("node:net"); const s = net.createServer(c => c.end("net")).listen(0, "127.0.0.1", () => { let o = ""; net.connect(s.address().port, "127.0.0.1").on("data", d => (o += d)).on("end", () => { s.close(); r(o); }); }); })',
  ],
  [
    "net small",
    '(() => { const n = require("node:net"); return [n.isIP("1.1.1.1"), n.isIPv6("::1"), typeof n.Socket, typeof new n.Socket().on, typeof n.BlockList]; })()',
  ],
  ["dgram", '(() => { const s = require("node:dgram").createSocket("udp4"); s.close(); return typeof s.send; })()'],
  [
    "dns",
    '[typeof require("node:dns").lookup, typeof require("node:dns/promises").resolve, typeof require("node:dns").getServers().length]',
  ],
  [
    "zlib sync",
    '(() => { const z = require("node:zlib"); return [String(z.gunzipSync(z.gzipSync("zz"))), String(z.inflateSync(z.deflateSync("dd"))), String(z.brotliDecompressSync(z.brotliCompressSync("bb"))), typeof z.constants.Z_BEST_SPEED, z.crc32?.("a")]; })()',
  ],
  [
    "zlib stream",
    'new Promise(r => { const z = require("node:zlib"); const g = z.createGzip(); const parts = []; g.on("data", d => parts.push(d)).on("end", () => r(String(z.gunzipSync(Buffer.concat(parts))))); g.end("gs"); })',
  ],
  ["zlib callback", 'new Promise(r => require("node:zlib").gzip("cb", (e, d) => r(d.length > 0)))'],
  [
    "url",
    '(() => { const u = require("node:url"); return [u.parse("http://a/b?c=1").query, u.format({ host: "a", pathname: "/b" }), u.fileURLToPath("file:///a"), u.pathToFileURL("/a").href, u.resolve("http://a/b", "c"), typeof u.URL, u.domainToASCII("\u00e9.com")]; })()',
  ],
  [
    "querystring",
    '[require("node:querystring").parse("a=1&b=2").b, require("node:querystring").stringify({ a: [1, 2] })]',
  ],
  ["string_decoder", 'new (require("node:string_decoder").StringDecoder)("utf8").write(Buffer.from([0xc3, 0xa9]))'],
  [
    "punycode",
    '(() => { try { return require("node:punycode").toASCII("\u00e9.com"); } catch (e) { return e.name; } })()',
  ],
  [
    "readline",
    'new Promise(r => { const { Readable } = require("node:stream"); const rl = require("node:readline").createInterface({ input: Readable.from(["l1\\nl2\\n"]) }); const out = []; rl.on("line", l => out.push(l)).on("close", () => r(out)); })',
  ],
  [
    "readline promises and tools",
    '[typeof require("node:readline/promises").createInterface, typeof require("node:readline").clearLine, typeof require("node:readline").emitKeypressEvents]',
  ],
  [
    "readline on stdin and stdout",
    '(() => { const rl = require("node:readline").createInterface({ input: process.stdin, output: process.stdout }); rl.close(); return typeof rl.question; })()',
  ],
  [
    "tty",
    '[require("node:tty").isatty(1), typeof require("node:tty").WriteStream, typeof require("node:tty").ReadStream]',
  ],
  [
    "assert",
    '(() => { const a = require("node:assert"); a.deepStrictEqual({ a: 1 }, { a: 1 }); try { a.strictEqual(1, 2); } catch (e) { return [e.name, e.code, e instanceof a.AssertionError, typeof a.strict.equal, typeof require("node:assert/strict").ok]; } })()',
  ],
  [
    "assert throws rejects",
    '(async () => { const a = require("node:assert"); a.throws(() => { throw new TypeError("t"); }, TypeError); await a.rejects(Promise.reject(new Error("r"))); a.match("ab", /a/); return "fine"; })()',
  ],
  [
    "async_hooks",
    '(async () => { const { AsyncLocalStorage, AsyncResource, executionAsyncId } = require("node:async_hooks"); const s = new AsyncLocalStorage(); return [await s.run(7, async () => { await 1; return s.getStore(); }), s.getStore() ?? null, typeof AsyncResource.bind, typeof executionAsyncId(), typeof AsyncLocalStorage.snapshot]; })()',
  ],
  [
    "async_hooks over timers",
    'new Promise(r => { const s = new (require("node:async_hooks").AsyncLocalStorage)(); s.run("kept", () => setTimeout(() => process.nextTick(() => queueMicrotask(() => r(s.getStore()))), 1)); })',
  ],
  [
    "worker_threads",
    '(() => { const w = require("node:worker_threads"); return [w.isMainThread, typeof w.threadId, typeof w.Worker, typeof w.MessageChannel, w.parentPort === null, typeof w.workerData, typeof w.getEnvironmentData, typeof w.receiveMessageOnPort]; })()',
  ],
  [
    "worker_threads Worker",
    'new Promise((r, j) => { const w = new (require("node:worker_threads").Worker)("require(\\"node:worker_threads\\").parentPort.postMessage(1 + 1)", { eval: true }); w.on("message", m => { w.terminate(); r(m); }).on("error", j); })',
  ],
  [
    "timers",
    '(() => { const t = require("node:timers"); return [t.setTimeout === setTimeout, typeof t.promises.setTimeout, typeof t.setImmediate]; })()',
  ],
  [
    "timers/promises",
    '(async () => { const t = require("node:timers/promises"); const out = [await t.setTimeout(1, "tp"), await t.setImmediate("ti")]; for await (const x of t.setInterval(1, "iv")) { out.push(x); break; } return out; })()',
  ],
  [
    "perf_hooks",
    '(() => { const p = require("node:perf_hooks"); return [p.performance === performance, typeof p.PerformanceObserver, typeof p.monitorEventLoopDelay, typeof p.createHistogram, typeof p.constants]; })()',
  ],
  [
    "vm",
    '(() => { const vm = require("node:vm"); return [vm.runInNewContext("a + 1", { a: 1 }), new vm.Script("2 + 2").runInThisContext(), vm.isContext(vm.createContext({})), typeof vm.compileFunction("return 1")()]; })()',
  ],
  [
    "v8",
    '(() => { const v = require("node:v8"); return [typeof v.getHeapStatistics().total_heap_size, v.deserialize(v.serialize({ a: 1 })).a, typeof v.setFlagsFromString]; })()',
  ],
  [
    "module",
    '(() => { const m = require("node:module"); return [m.builtinModules.includes("fs"), m.isBuiltin("node:fs"), typeof m.createRequire(import.meta.url)("node:path").join, typeof m._resolveFilename, typeof m._extensions, typeof m.Module, typeof m.wrap("x"), typeof m._cache]; })()',
  ],
  [
    "diagnostics_channel",
    '(() => { const d = require("node:diagnostics_channel"); const c = d.channel("k"); let g; c.subscribe(m => (g = m)); c.publish(4); return [g, c.hasSubscribers, typeof d.tracingChannel]; })()',
  ],
  [
    "small modules",
    '["constants", "console", "process", "sys", "domain", "cluster", "inspector", "repl", "trace_events", "wasi", "test", "sqlite", "path/posix", "path/win32", "util/types", "inspector/promises"].map(n => { try { return n + ":" + typeof require("node:" + n); } catch (e) { return n + ":" + e.name; } })',
  ],
  ["cluster and domain", '[require("node:cluster").isPrimary, typeof require("node:domain").create().run]'],
  [
    "node:console",
    '(() => { const c = require("node:console"); return [c === console, typeof c.Console, typeof c.log]; })()',
  ],
  ["node:process", '[require("node:process") === process, typeof require("node:process").stdout.write]'],
  [
    "undici ws",
    '["undici", "ws", "detect-libc", "@vercel/fetch", "isomorphic-fetch", "node-fetch", "abort-controller", "utf-8-validate"].map(n => { try { return n + ":" + typeof require(n); } catch (e) { return n + ":" + e.name; } })',
  ],
  [
    "async iteration helpers",
    "(async () => [await Array.fromAsync((async function* () { yield 1; yield 2; })()), await Promise.allSettled([Promise.reject(1)]).then(x => x[0].status), await Promise.any([Promise.resolve(3)]), typeof Promise.withResolvers().resolve, await Promise.try(() => 4)])()",
  ],
  [
    "iterator helpers",
    '[[1, 2, 3].values().map(x => x * 2).filter(x => x > 2).take(1).toArray(), Iterator.from([1]).toArray(), [..."ab"].entries().toArray()]',
  ],
  [
    "Intl",
    '[new Intl.NumberFormat("en").format(1234.5), new Intl.DateTimeFormat("en", { timeZone: "UTC" }).format(0), new Intl.PluralRules("en").select(1), [...new Intl.Segmenter("en").segment("ab")].length, new Intl.ListFormat("en").format(["a", "b"]), new Intl.RelativeTimeFormat("en").format(-1, "day"), "a".localeCompare("b")]',
  ],
  [
    "regexp and string",
    '["aXbX".replaceAll("X", "-"), [..."a1b2".matchAll(/\\d/g)].length, "a-b".split(/-/), /(?<y>\\d)/.exec("a1").groups.y, "ab".at(-1), "a".padStart(3, "-"), "abc".search(/c/), RegExp.escape?.("a.b")]',
  ],
  [
    "typed arrays",
    "[new Uint8Array([3, 1, 2]).sort().join(), new Float64Array(2).fill(1.5).map(x => x * 2).join(), Uint8Array.from([1, 2]).toReversed().join(), new Uint8Array([1, 2]).toBase64?.(), new DataView(new ArrayBuffer(4)).getInt32(0), new Uint8Array(new ArrayBuffer(8, { maxByteLength: 16 })).length, new BigInt64Array(1)[0].toString()]",
  ],
  [
    "collections",
    '[[...new Set([1, 2]).union(new Set([3]))], Object.groupBy([1, 2, 3], x => (x % 2 ? "o" : "e")), [...Map.groupBy([1, 2], x => x % 2).keys()], new WeakRef({}).deref() !== undefined, typeof new FinalizationRegistry(() => {}).register, [3, 1].toSorted(), [1, 2].with(0, 9), [1, [2, [3]]].flat(2), [1, 2, 3].findLast(x => x < 3)]',
  ],
  [
    "Error things",
    '(() => { const e = new Error("m", { cause: 1 }); const o = {}; Error.captureStackTrace(o); return [e.cause, typeof o.stack, typeof Error.stackTraceLimit, new AggregateError([e]).errors.length, typeof new SuppressedError(1, 2).suppressed, Error.isError?.(e)]; })()',
  ],
  [
    "using",
    '(() => { const log = []; { using a = { [Symbol.dispose]() { log.push("disposed"); } }; log.push("in"); } const s = new DisposableStack(); s.defer(() => log.push("deferred")); s.dispose(); return log; })()',
  ],
  [
    "JSON and Date",
    '[JSON.stringify({ a: [1, { b: 2 }], d: new Date(0) }, null, 1).length, JSON.parse("[1,{\\"a\\":2}]", (k, v) => (typeof v === "number" ? v + 1 : v)), new Date(0).toISOString(), new Date(0).toLocaleDateString("en-US", { timeZone: "UTC" }), JSON.rawJSON?.("1").rawJSON]',
  ],
  [
    "Proxy Reflect Symbol",
    '[Reflect.ownKeys(new Proxy({ a: 1 }, {})), Symbol.for("k").description, typeof Symbol.asyncDispose, Reflect.construct(Date, [0]).getTime(), Object.fromEntries(new Map([["a", 1]])), Object.entries({ a: 1 })]',
  ],
  [
    "WebAssembly",
    "(async () => { const b = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 127, 3, 2, 1, 0, 7, 5, 1, 1, 102, 0, 0, 10, 6, 1, 4, 0, 65, 42, 11]); return [(await WebAssembly.instantiate(b)).instance.exports.f(), WebAssembly.validate(b)]; })()",
  ],
  [
    "Atomics and shared memory",
    "(() => { const a = new Int32Array(new SharedArrayBuffer(8)); Atomics.add(a, 0, 2); return [Atomics.load(a, 0), typeof Atomics.waitAsync, Atomics.notify(a, 0)]; })()",
  ],
  [
    "generators and async generators",
    "(async () => { function* g() { const x = yield 1; return x; } const i = g(); i.next(); async function* ag() { yield* [1, 2]; } const out = []; for await (const x of ag()) out.push(x); return [i.next(5), out]; })()",
  ],
];

/** One test. Its name begins with its kind. */
function drawTest(project: Project, isTypeScript: boolean): Drawn {
  const without = options.without.split(",").filter(Boolean);
  const only = options.only.split(",").filter(Boolean);
  for (let tries = 0; tries < 100_000; tries++) {
    const drawn = drawAnyTest(project, isTypeScript);
    if (
      project.onlyKind
        ? drawn.kind === project.onlyKind
        : project.sparse.length
          ? project.sparse.includes(drawn.kind)
          : !without.includes(drawn.kind) && (only.length === 0 || only.includes(drawn.kind))
    )
      return drawn;
  }
  throw new Error(
    `no kind of test is left to draw: --only ${options.only} --without ${options.without} ${project.onlyKind}`,
  );
}

function drawAnyTest(project: Project, isTypeScript: boolean): Drawn {
  const any = isTypeScript ? ": any" : "";
  const k = 1 + project.below(9);
  const built = project.pick(replaceable);
  const [holder, name, replacement, here, there] = built;
  return project.pick<() => Drawn>([
    () => ({
      kind: "state of a helper",
      needs: ["state", "uses"],
      lines: [
        `note("bumped", state.bump(), state.bump(), state.count, uses.both(${k}));`,
        `state.table.rows.push(${k}); note("rows", state.size(), state.loadedAs);`,
      ],
    }),
    () => ({
      kind: "spyOn a function of a module",
      needs: ["math", "uses"],
      lines: [
        `const spy = spyOn(math, "add").${project.pick([`mockImplementation((a${any}, b${any}) => a * b + ${k})`, `mockReturnValue(${k})`, `mockImplementationOnce(() => ${k})`])};`,
        `note("spied", math.add(2, 3), math.twice(4), math.thrice(2), uses.doubled(3), spy.mock.calls.length);`,
        `spy.mockRestore(); note("restored", math.add(2, 3), math.twice(4), uses.doubled(3));`,
      ],
    }),
    () => ({
      kind: "spyOn a method",
      needs: ["counters", "uses"],
      lines: [
        project.pick([
          `const spy = spyOn(counters.Counter.prototype, "next").mockReturnValue(-${k});`,
          `const spy = spyOn(counters.shared, "next").mockImplementation(() => ${k});`,
          `const spy = spyOn(counters.shared, "double", "get").mockReturnValue(${k});`,
          `const spy = spyOn(counters.Counter, "reset").mockImplementation(() => {});`,
        ]),
        `const own = counters.make(${k}); counters.Counter.reset();`,
        `note("spied", own.next(), own.twoSteps(), own.double, counters.shared.next(), counters.shared.double, uses.stepped(), counters.Counter.made, spy.mock.calls.length);`,
        `spy.mockRestore(); note("restored", own.next(), counters.shared.next(), counters.shared.double, uses.stepped());`,
      ],
    }),
    () => ({
      kind: `spyOn a built-in`,
      needs: ["builtins"],
      lines: [
        `const spy = spyOn(${holder}${isTypeScript ? " as any" : ""}, "${name}").mockImplementation(${replacement});`,
        `let got${any}; try { got = [${here}, ${there}, spy.mock.calls.length]; } finally { spy.mockRestore(); }`,
        `note("${holder}.${name} spied", got); note("restored", typeof (${here}), typeof (${there}));`,
      ],
    }),
    () => ({
      kind: `a built-in is replaced`,
      needs: ["builtins"],
      lines: [
        `const real = ${holder}.${name};`,
        `let got${any}; ${isTypeScript ? "// @ts-ignore\n  " : ""}${holder}.${name} = ${replacement};`,
        `try { got = [${here}, ${there}]; } finally { ${isTypeScript ? "(" + holder + " as any)" : holder}.${name} = real; }`,
        `note("${holder}.${name} replaced", got); note("put back", typeof (${here}), typeof (${there}));`,
      ],
    }),
    () => ({
      kind: `a built-in stays replaced`,
      needs: ["builtins"],
      lines: [
        `note("before", typeof (${here}) === typeof (${there}));`,
        `${isTypeScript ? "(" + holder + " as any)" : holder}.${name} = ${replacement};`,
        `leftReplaced.push(() => [${here}, ${there}]);`,
      ],
    }),
    () => ({
      kind: "mock.module of a helper",
      isAsync: true,
      needs: ["math", "uses", "scale"],
      lines: [
        `mock.module("./helpers/math.ts", () => ({ add: (a${any}, b${any}) => a - b, twice: (x${any}) => x + ${k}, thrice: () => 0, default: () => "mocked" }));`,
        `const fresh${any} = await import("./helpers/math.ts");`,
        `note("mocked", fresh.add(5, 3), fresh.twice(1), fresh.default(1), math.add(5, 3), math.twice(1), scale(2), uses.doubled(1));`,
        ...(project.chance(50) ? [`mock.restore(); note("behind restore", math.add(5, 3), uses.doubled(1));`] : []),
      ],
    }),
    () => ({
      kind: "mock.module of a built-in module",
      isAsync: true,
      needs: ["nodes"],
      lines: [
        project.pick([
          `mock.module("node:path", () => ({ basename: () => "mocked", default: { basename: () => "mocked by default" } }));`,
          `mock.module("node:os", () => ({ EOL: "mocked", default: { EOL: "mocked by default" } }));`,
        ]),
        `const path${any} = await import("node:path"); const os${any} = await import("node:os");`,
        `note("mocked", path.basename("/a/b.txt"), JSON.stringify(os.EOL), nodes.base("/a/b.txt"), nodes.endOfLine());`,
      ],
    }),
    () => {
      const [file, reads] = project.pick([
        // Helpers of this kind's own: a helper that is taken out of the cache is another module to whatever test of the file comes next.
        ["./helpers/evicted.js", "count"],
        ["./helpers/evicted.cjs", "read()"],
      ]);
      const load = project.pick([`require("${file}")`, "require(path)"]);
      return {
        kind: "require.cache",
        needs: [],
        lines: [
          `const path = require.resolve("${file}");`,
          `const first = ${load}; first.bump(); first.bump();`,
          project.pick([
            "delete require.cache[path];",
            `for (const key of Object.keys(require.cache)) if (key.includes("evicted")) delete require.cache[key];`,
            "Reflect.deleteProperty(require.cache, path);",
          ]),
          `const second = ${load};`,
          `note("behind the delete", first.${reads}, second.${reads}, first === second, path in require.cache);`,
        ],
      };
    },
    () => ({
      kind: project.opensTheModules ? "a fresh copy" : "a fresh copy where nothing opens the modules",
      isAsync: true,
      needs: ["uses"],
      lines: [
        ...project.pick([
          [`const fresh${any} = await import("./helpers/uses.js?again${k}");`],
          [`const fresh${any} = await import("./helpers/uses.js?t=" + ${k});`],
          [
            `delete require.cache[require.resolve("./helpers/imports-evicted.js")]; const fresh${any} = await import("./helpers/imports-evicted.js"); note("evicted alone", typeof fresh.next());`,
          ],
          [`const fresh${any} = await import(import.meta.dir + "/helpers/uses.js?again${k}");`],
        ]),
        `note("a fresh copy", fresh === uses, Object.keys(fresh).sort().join(), typeof fresh.doubled === "function" ? fresh.doubled(${k}) : "none");`,
      ],
    }),
    () => {
      // NOTHING IN A PROJECT NAMES THE INNER MODULE but import statements: one import() or require.resolve of it anywhere in the run gives it a state of its own, and a fault of modules that are reached by statements alone is gone from the whole run.
      // Helpers of this kind's own, which nothing else loads: the first test of a file that asks for a copy meets a compiled module that HAS NOT RUN YET behind it, a later one meets it loaded. Both are drawn.
      const outer = project.pick([
        "copied-star.js",
        "copied-named.js",
        "copied-namespace.js",
        "copied-uses.js",
        "copied-requires.cjs",
      ]);
      return {
        kind: "a copy over a helper that may not have run",
        isAsync: true,
        needs: [],
        lines: [
          ...(project.chance(35)
            ? [`note("loaded first", Object.keys(await import("./helpers/${outer}")).sort().join());`]
            : []),
          ...project.pick([
            [`const copy${any} = await import("./helpers/${outer}?again${k}");`],
            [`const copy${any} = await import("./helpers/${outer}?t=" + ${k});`],
            [
              `const path = require.resolve("./helpers/${outer}"); await import("./helpers/${outer}"); delete require.cache[path]; const copy${any} = await import("./helpers/${outer}");`,
            ],
            [`const copy${any} = require("./helpers/${outer}?required${k}");`],
          ]),
          `note("the copy", Object.keys(copy).sort().join(), copy.inner ?? copy.one?.inner ?? copy.mine ?? copy.default?.mine, typeof (copy.f ?? copy.one?.f ?? copy.default?.f));`,
        ],
      };
    },
    () => {
      // The other way round: NOTHING names the outer module without a query, so the copy comes from disk, and the inner one is compiled only because require.resolve names it. It has not run where this test is the first of its file to ask.
      const which = project.pick(["star", "named", "namespace", "uses"]);
      return {
        kind: "a copy from disk over a helper that is only resolved",
        isAsync: true,
        needs: [],
        lines: [
          project.pick([
            `require.resolve("./helpers/resolved-inner-${which}.js");`,
            `delete require.cache[require.resolve("./helpers/resolved-inner-${which}.js")];`,
            `note("resolved", import.meta.resolve("./helpers/resolved-inner-${which}.js").split("/").at(-1));`,
          ]),
          `const copy${any} = await import(${project.pick([`"./helpers/from-disk-${which}.js?again${k}"`, `"./helpers/from-disk-${which}.js?t=" + ${k}`])});`,
          `note("the copy", Object.keys(copy).sort().join(), copy.inner ?? copy.one?.inner ?? copy.mine);`,
        ],
      };
    },
    () => {
      const drawn = project.several(1, 4, () =>
        project.pick(project.bare ? realmThings.filter(([, text]) => !/node:|require\(/.test(text)) : realmThings),
      );
      return {
        kind: "things of the realm are touched",
        isAsync: true,
        needs: [],
        lines: drawn.map(
          ([label, text]) =>
            `try { note(${JSON.stringify(label)}, asText(await (async () => (${text}))())); } catch (error${any}) { note(${JSON.stringify(label)}, "threw", error?.name, String(error?.message).slice(0, 60)); }`,
        ),
      };
    },
    () => {
      const file = project.pick(project.made);
      const id = "made" + file.replace(/\D/g, "");
      return {
        kind: "what a file made of the packages",
        needs: [],
        imports: [`import * as ${id} from "./${file}";`],
        lines: [
          `const all${any} = ${id}; note("made", asText(all.made ?? all.make()), asText(all.before?.made ?? all.before?.make?.() ?? null));`,
        ],
      };
    },
    () => {
      // The Worker's realm runs no compiled module, and what it runs is transpiled when it is loaded. Once none of these answered in a layered run, while a Worker on a file of the project did.
      const path = `process.env.SEEN_IN + "/worker-${k}-" + process.pid`;
      const made = project.pick([
        `new (require("node:worker_threads").Worker)(\`require("node:worker_threads").parentPort.postMessage(${k} + 1)\`, { eval: true })`,
        `(require("node:fs").writeFileSync(${path} + ".mjs", \`import { parentPort } from "node:worker_threads";\\nparentPort.postMessage(${k} + 2);\\n\`), new (require("node:worker_threads").Worker)(${path} + ".mjs"))`,
        `(require("node:fs").writeFileSync(${path} + ".cjs", \`require("node:worker_threads").parentPort.postMessage(${k} + 3);\\n\`), new (require("node:worker_threads").Worker)(${path} + ".cjs"))`,
        `(require("node:fs").writeFileSync(${path} + ".js", \`postMessage(${k} + 4);\\n\`), new Worker(${path} + ".js"))`,
        `new Worker(URL.createObjectURL(new Blob([\`postMessage(${k} + 5);\`], { type: "application/javascript" })))`,
      ]);
      return {
        kind: "a Worker on code that is not compiled",
        isAsync: true,
        needs: [],
        lines: [
          `const worker${any} = ${made};`,
          `const answer = new Promise((resolve, reject) => { if (worker.on) { worker.on("message", resolve); worker.on("error", reject); } else { worker.onmessage = (event${any}) => resolve(event.data); worker.onerror = (event${any}) => reject(new Error(event.message)); } });`,
          `try { note("answered", await Promise.race([answer, new Promise(resolve => setTimeout(() => resolve("no answer"), 10000))])); } catch (error${any}) { note("threw", error?.name); } finally { await worker.terminate(); }`,
        ],
      };
    },
    () => ({
      kind: "node:vm alone runs text",
      needs: [],
      imports: [`import { createContext, runInContext, runInNewContext } from "node:vm";`],
      lines: [
        project.pick([
          `note("ran", runInContext("1 + ${k}", createContext({})));`,
          `note("ran", runInNewContext("a + ${k}", { a: 1 }));`,
          `const run = (text${any}) => runInContext(text, createContext({ b: 2 })); note("ran", run("b * ${k}"));`,
        ]),
      ],
    }),
    () => ({
      kind: "a tool of bun:test goes somewhere",
      needs: [],
      lines: [
        `(globalThis${isTypeScript ? " as any" : ""}).kept = ${project.pick(["mock", "jest", "spyOn", "mock.module", "expect", "test", "[mock, jest]", "{ mock }", "Bun.jest"])}; note("kept", typeof (globalThis${isTypeScript ? " as any" : ""}).kept);`,
      ],
    }),
    () => {
      // Built-in modules that no helper and no other kind imports: whether a statement anywhere in the run imports the module decides what the build leaves open.
      const [module, member, given] = project.pick([
        ["node:querystring", "escape", `"a b"`],
        ["node:zlib", "crc32", `"a"`],
        ["node:dns", "getDefaultResultOrder", ""],
        ["node:readline", "clearLine", "process.stdout, 0"],
        ["node:v8", "cachedDataVersionTag", ""],
        ["node:punycode", "toASCII", `"a"`],
      ]);
      return {
        kind: project.opensTheModules
          ? "a built-in module is mocked and called"
          : "a built-in module is mocked and called where nothing opens the modules",
        isAsync: true,
        needs: [],
        lines: [
          `const made = () => "mocked ${k}";`,
          `mock.module("${module}", () => ({ ${member}: made${project.chance(50) ? `, default: { ${member}: made }` : ""} }));`,
          ...project.pick([
            [
              `const got${any} = await import("${module}"); note("read and called", got.${member} === made, got.${member}(${given}));`,
            ],
            [
              `note("called at once", (await import("${module}")${isTypeScript ? " as any" : ""}).${member}(${given}));`,
            ],
            [
              `const { ${member}: taken }${any} = await import("${module}"); note("taken apart", taken === made, taken(${given}));`,
            ],
          ]),
        ],
      };
    },
    () => ({
      kind: project.opensTheModules
        ? "a module is loaded behind an eviction in an open run"
        : "a module is loaded behind an eviction",
      isAsync: true,
      needs: [],
      lines: [
        `const path = require.resolve("./helpers/evicted.js");`,
        `const first = require(path); first.bump(); first.bump(); delete require.cache[path];`,
        ...(project.chance(40)
          ? [
              `const second = ${project.pick(["require(path)", `await import("./helpers/evicted.js")`])}; note("anew", second.count);`,
            ]
          : []),
        `const late${any} = ${project.pick([`await import("./helpers/imports-evicted.js")`, `require("./helpers/imports-evicted.js")`, `await import(["./helpers", "imports-evicted.js"].join("/"))`])};`,
        `note("loaded behind it", late.seenWhenLoaded, late.next(), first.count);`,
      ],
    }),
    () => ({
      kind: "a Worker",
      isAsync: true,
      needs: ["state"],
      lines: [
        `state.bump();`,
        `const worker = new Worker(${project.pick([`new URL("./helpers/worker.js", import.meta.url).href`, `new URL("./helpers/worker.js", import.meta.url)`, `require.resolve("./helpers/worker.js")`])});`,
        `const answer = await new Promise((resolve, reject) => { worker.onmessage = event => resolve(event.data); worker.onerror = event => reject(new Error(String(event.message))); worker.postMessage(${k}); });`,
        `worker.terminate(); note("answered", answer, state.count);`,
      ],
    }),
    () => ({
      kind: "fake timers",
      needs: ["builtins"],
      lines: [
        `jest.useFakeTimers();`,
        `try {`,
        `  let fired = 0; const order${isTypeScript ? ": string[]" : ""} = [];`,
        `  setTimeout(() => { fired++; order.push("late"); }, ${k * 100}); setTimeout(() => order.push("early"), ${k * 10}); const every = setInterval(() => order.push("tick"), ${k * 40});`,
        `  jest.advanceTimersByTime(${k * 100 - 1}); note("just before", fired, order.join());`,
        `  jest.advanceTimersByTime(1); note("at the time", fired, order.join()); clearInterval(every);`,
        ...(project.chance(50)
          ? [
              `  jest.setSystemTime(new Date(${k}e11)); note("the clock", Date.now(), new Date().getFullYear(), builtins.now(), builtins.year());`,
            ]
          : [`  setTimeout(() => order.push("last"), 5e6); jest.runAllTimers(); note("all ran", order.at(-1));`]),
        `} finally { jest.useRealTimers(); }`,
        `note("real again", Date.now() > 1.6e12, builtins.now() > 1.6e12);`,
      ],
    }),
    () => ({
      kind: "text that is run",
      isAsync: true,
      needs: ["math"],
      lines: [
        `note("a function of text", new Function("a", "b", "return a + b + ${k}")(1, 2), (0, eval)("${k} + 1"), ((held) => eval("held.add(${k}, 1)"))(math));`,
        `const made${any} = await import("data:text/javascript,export default ${k} * 2; export const name = 'data';"); note("a module of text", made.default, made.name);`,
      ],
    }),
    () => ({
      kind: "globals that a file leaves behind",
      needs: [],
      lines: [
        `const world${any} = globalThis; world.leftBehind = (world.leftBehind ?? 0) + 1; process.env.LEFT_BEHIND = (process.env.LEFT_BEHIND ?? "") + "x";`,
        `note("left behind", world.leftBehind, process.env.LEFT_BEHIND, typeof world.loadsOfState);`,
      ],
    }),
    () => ({
      kind: "matchers",
      isAsync: true,
      needs: ["math", "counters"],
      lines: [
        `const called = mock((x${any}) => math.twice(x)); called(${k}); called(${k + 1});`,
        `expect(called).toHaveBeenCalledTimes(2); expect(called).toHaveBeenCalledWith(${k}); expect(called.mock.results[1].value).toBe(${2 * k + 2});`,
        `expect({ a: [1, { b: ${k} }], c: undefined }).toEqual({ a: [1, { b: ${k} }] }); expect(counters.make(${k})).toMatchObject({ step: ${k}, value: 0 });`,
        `expect(() => { throw new TypeError("thrown ${k}"); }).toThrow("thrown ${k}"); await expect(Promise.resolve(math.add(${k}, 1))).resolves.toBe(${k + 1}); await expect(Promise.reject(new Error("no"))).rejects.toThrow("no");`,
        `expect([${k}, "a"]).toEqual([expect.any(Number), expect.stringContaining("a")]);`,
        ...(project.chance(25) ? [`expect(math.add(${k}, 1)).toBe(${k});`] : []),
      ],
    }),
    () => {
      const wrong = project.pick([
        '"a text"',
        "undefined",
        "null",
        "{ not: 1 }",
        "10n",
        "[1]",
        "NaN",
        "Promise.resolve(1)",
        "-0",
        "() => 1",
      ]);
      return {
        kind: "a mock of another type",
        needs: ["math", "uses"],
        lines: [
          `const spy = spyOn(math, "${project.pick(["add", "add", "twice"])}").mockReturnValue(${wrong}${isTypeScript ? " as any" : ""});`,
          `for (const ask of [() => math.add(1, 2), () => math.twice(2), () => math.thrice(2), () => uses.doubled(1), () => typeof math.twice(3), () => math.twice(1) + 1, () => uses.both(1)]) { try { note("asked", ask()); } catch (error) { note("threw", error); } }`,
          `spy.mockRestore(); note("restored", math.thrice(2), uses.doubled(1));`,
        ],
      };
    },
    () => ({
      kind: "a prototype is patched",
      needs: ["counters", "uses"],
      lines: [
        `const proto${any} = counters.Counter.prototype; const own${any} = counters.make(${k});`,
        ...project.pick([
          [
            `const real = proto.next; proto.next = function () { return "patched"; };`,
            `const undo = () => { proto.next = real; };`,
          ],
          [
            `const real = Object.getOwnPropertyDescriptor(proto, "double"); Object.defineProperty(proto, "double", { get() { return "patched"; }, configurable: true });`,
            `const undo = () => { Object.defineProperty(proto, "double", real${isTypeScript ? "!" : ""}); };`,
          ],
          [`const real = proto.next; delete proto.next;`, `const undo = () => { proto.next = real; };`],
          [
            `own.next = () => "its own"; proto.added = function () { return this.step; };`,
            `const undo = () => { delete proto.added; };`,
          ],
          [
            `Object.setPrototypeOf(own, { next() { return "another prototype"; }, twoSteps: proto.twoSteps });`,
            `const undo = () => {};`,
          ],
        ]),
        `try { for (const ask of [() => own.next(), () => own.twoSteps(), () => own.double, () => counters.shared.next(), () => uses.stepped(), () => own.added?.(), () => counters.make(2).twoSteps()]) { try { note("asked", ask()); } catch (error) { note("threw", error); } } } finally { undo(); }`,
        `note("undone", counters.make(3).twoSteps(), counters.make(3).double);`,
      ],
    }),
    () => ({
      kind: "shapes that the helper never saw",
      needs: ["shapes"],
      lines: [
        `class Odd extends shapes.Square { area()${any} { return ${project.pick(["-1", '"a text"', "super.area() + 0.5", "undefined", "10n"])}; } }`,
        `const all${any} = [new shapes.Square(${k}), new shapes.Circle(1), new Odd(2), { area: () => ${k}, kind: "literal" }, { kind: "other order", extra: 1, area() { return 0.5; } }, { get kind() { return "getter"; }, area: () => 1 }, new Proxy(new shapes.Circle(2), {}), Object.create(new shapes.Square(3))];`,
        `for (const shape of all) { try { note("one", shapes.label(shape), shapes.register(shape), shape.describe?.()); } catch (error) { note("threw", error); } }`,
        `try { note("total", shapes.total(all)); } catch (error) { note("threw", error); } note("registry", [...shapes.registry.keys()].join());`,
      ],
    }),
    () => ({
      kind: "an import under a computed name",
      isAsync: true,
      needs: [],
      lines: [
        `const name = ["ma", "th"].join(""); const loaded${any} = await import("./helpers/" + name + ".ts"); note("imported", loaded.add(${k}, 1), loaded.default(2));`,
        `const required${any} = require("./helpers/" + ["pla", "in"].join("") + ".cjs"); note("required", required.bump(), required.name);`,
        `for (const each of ["state.js", "counters.ts", "missing.js"]) { try { note(each, Object.keys(await import(\`./helpers/\${each}\`)).sort().join()); } catch (error${any}) { note(each, error.name); } }`,
      ],
    }),
    () => ({
      kind: "a package is mocked",
      isAsync: true,
      needs: ["packages"],
      lines: [
        `note("before", packages.welcome("a"), packages.level());`,
        project.pick([
          `mock.module("tiny-pkg", () => ({ greet: (name${any}) => "mocked " + name, version: "${k}", default: {} }));`,
          `mock.module("old-pkg", () => ({ default: { shout: () => "mocked", level: ${k} }, shout: () => "mocked", level: ${k} }));`,
        ]),
        `const tiny${any} = await import("tiny-pkg"); note("mocked", tiny.greet("b"), tiny.version, require("old-pkg").level, packages.welcome("a"), packages.level());`,
      ],
    }),
    () => ({
      kind: "the class Date is replaced",
      needs: ["builtins"],
      lines: [
        `const RealDate = Date; class FixedDate extends RealDate { constructor(...given${isTypeScript ? ": any[]" : ""}) { super(...(given.length ? given : [${k}e11])${isTypeScript ? " as []" : ""}); } static now() { return ${k}e11; } }`,
        `(globalThis${isTypeScript ? " as any" : ""}).Date = FixedDate;`,
        `try { note("fixed", Date.now(), new Date().getFullYear(), builtins.now(), builtins.year(), new Date(0).getTime(), new Date() instanceof RealDate, Date.name); } finally { globalThis.Date = RealDate; }`,
        `note("real again", Date === RealDate, builtins.now() > 1.6e12);`,
      ],
    }),
    () => ({
      kind: "Object.prototype holds one more",
      needs: ["builtins"],
      lines: [
        `(Object.prototype${isTypeScript ? " as any" : ""}).extra = ${k};`,
        `try { const walked = []; for (const key in { a: 1 }) walked.push(key); note("seen", walked.join(), builtins.keys({ a: 1 }), ({}${isTypeScript ? " as any" : ""}).extra, builtins.text({ a: 1 }), "extra" in {}, Object.keys({ ...{ a: 1 } }).join(), Object.keys(Object.assign({}, { b: 2 })).join(), ([1, 2]${isTypeScript ? " as any" : ""}).extra); } finally { delete (Object.prototype${isTypeScript ? " as any" : ""}).extra; }`,
        `note("gone", ({}${isTypeScript ? " as any" : ""}).extra);`,
      ],
    }),
    () => ({
      kind: "a test that is tried again",
      needs: ["state"],
      options: project.pick(["{ retry: 2 }", "{ retry: 1 }", "{ repeats: 2 }"]),
      lines: [
        `const tries = state.bump(); note("try", tries); expect(tries).toBeGreaterThan(${project.pick([0, 1, 2])});`,
      ],
    }),
    () => ({
      kind: "what the preload left",
      needs: ["packages", "builtins"],
      lines: [
        `const left = (globalThis${isTypeScript ? " as any" : ""}).fromThePreload; note("left", left?.value, left?.calls, left?.last, packages.welcome("p"), Math.max(1, 2), builtins.largest(1, 2));`,
      ],
    }),
    () => ({
      kind: "console and process are spied",
      needs: [],
      lines: [
        `const log = spyOn(console, "log").mockImplementation(() => {}); const cwd = spyOn(process, "cwd").mockReturnValue("/spied");`,
        `try { console.log("quiet", ${k}); note("spied", log.mock.calls, process.cwd(), cwd.mock.calls.length); } finally { log.mockRestore(); cwd.mockRestore(); }`,
        `process.env.SET_BY_A_TEST = "${k}"; note("restored", process.cwd() !== "/spied", process.env.SET_BY_A_TEST, typeof console.log);`,
      ],
    }),
    () => ({
      kind: "the names of jest",
      needs: ["math", "counters"],
      lines: [
        `const made = jest.fn((x${any}) => x + ${k}); made(1); made(2); const spied = jest.spyOn(math, "twice").mockImplementation(() => ${k}); const method = jest.spyOn(counters.shared, "next");`,
        `note("called", made.mock.calls, made.mock.results.map(each => each.value), math.twice(9), math.thrice(1), counters.shared.next() > 0, method.mock.calls.length, spied.mock.calls.length);`,
        project.pick([
          `jest.clearAllMocks(); note("cleared", made.mock.calls.length, math.twice(9));`,
          `jest.restoreAllMocks(); note("restored", made.mock.calls.length, math.twice(9));`,
          `mock.restore(); note("restored", math.twice(9));`,
        ]),
        `jest.restoreAllMocks(); note("at the end", math.twice(9), math.thrice(1));`,
      ],
    }),
    () => ({
      kind: "where the file is",
      needs: [],
      lines: [
        `note("meta", import.meta.file, import.meta.main, import.meta.path.split("/").at(-1), import.meta.url.split("/").at(-1), import.meta.dir.split("/").at(-1), typeof import.meta.require);`,
        `note("resolved", import.meta.resolve("./helpers/math.ts").split("/").slice(-2).join("/"), require.resolve("tiny-pkg").split("/").slice(-3).join("/"), Bun.resolveSync("./helpers/state.js", import.meta.dir).split("/").at(-1));`,
      ],
    }),
    () => ({
      kind: "who is on the stack",
      needs: ["math", "uses", "counters"],
      lines: [
        `const names = (error${any}) => String(error.stack).split("\\n").slice(1, 5).map(line => /at (?:new |async )?([\\w.<>]+)/.exec(line)?.[1] ?? "?").join(" < ");`,
        `const spy = spyOn(math, "add").mockImplementation(() => { throw new Error("from the mock"); });`,
        `for (const ask of [() => math.twice(1), () => uses.doubled(1), () => math.thrice(1)]) { try { ask(); note("no error"); } catch (error${any}) { note(error.message, names(error)); } }`,
        `spy.mockRestore(); try { math.add(1n${isTypeScript ? " as any" : ""}, 1); } catch (error${any}) { note(error.name, names(error)); }`,
      ],
    }),
    () => ({
      kind: "a module that hands on exports",
      needs: ["again", "math", "state"],
      lines: [
        `note("the same", again.add === math.add, again.increase === state.bump, again.table === state.table, Object.keys(again).sort().join());`,
        `const spy = spyOn(${project.pick(["again", "math"])}, "add").mockReturnValue(${k});`,
        `note("spied", again.add(1, 1), math.add(1, 1), again.twice(1), math.twice(1), again.increase(), state.count); spy.mockRestore(); note("restored", again.add(1, 1), math.add(1, 1));`,
      ],
    }),
    () => ({
      kind: "snapshots",
      needs: ["counters", "shapes", "math"],
      lines: [
        `expect({ counter: counters.make(${k}), shape: new shapes.Circle(${k}), add: math.add, list: [1, "a", null, undefined, -0, ${k}n], map: new Map([[1, new Set([2])]]), when: new Date(${k}e11), error: new RangeError("r"), nested: { deep: { deeper: [[[]]] } } }).toMatchSnapshot();`,
        `expect(shapes.label(new shapes.Square(${k}))).toMatchSnapshot("a label"); expect(() => shapes.label(null${isTypeScript ? " as any" : ""})).toThrowErrorMatchingSnapshot();`,
      ],
    }),
    () => {
      const [first, second] = [project.below(project.graph.count), project.below(project.graph.count)];
      const isLate = project.chance(30);
      return {
        kind: "a graph of modules",
        isAsync: true,
        needs: [],
        imports: isLate
          ? []
          : [...new Set([first, second])].map(
              each => `import * as m${each} from "./graph/${project.graph.nameOf(each)}";`,
            ),
        lines: [
          ...(isLate
            ? [...new Set([first, second])].map(
                each => `const m${each}${any} = await import("./graph/${project.graph.nameOf(each)}");`,
              )
            : []),
          `note("order", (globalThis${isTypeScript ? " as any" : ""}).order.join(" | "));`,
          `note("values", m${first}.value${first}, m${first}.get${first}(), m${second}.get${second}(), Object.keys(m${first}).sort().join());`,
          `m${second}.set${second}(${k}00); note("behind a store", m${second}.value${second}, m${first}.get${first}(), m${second}.get${second}());`,
        ],
      };
    },
    () => ({
      kind: "an error that nobody catches",
      isAsync: true,
      needs: ["math"],
      lines: [
        `note("reached", math.add(${k}, 1));`,
        project.pick([
          `setTimeout(() => { throw new Error("thrown by a timer ${k}"); }, 0); await new Promise(resolve => setTimeout(resolve, 10));`,
          `Promise.reject(new Error("rejected and left ${k}")); await new Promise(resolve => setTimeout(resolve, 10));`,
          `queueMicrotask(() => { throw new TypeError("thrown by a job ${k}"); }); await new Promise(resolve => setTimeout(resolve, 10));`,
          `void (async () => { await null; math.add(1n${isTypeScript ? " as any" : ""}, 1); })(); await new Promise(resolve => setTimeout(resolve, 10));`,
        ]),
      ],
    }),
    () => ({
      kind: "a helper under an alias",
      isAsync: true,
      needs: ["math", "uses"],
      imports: [
        `import * as aliased from "@helpers/math.ts";`,
        `import { bump as bumpByAlias } from "@helpers/state.js";`,
      ],
      lines: [
        `note("one module", aliased.add === math.add, aliased.twice(${k}), bumpByAlias(), (await import("@helpers/state.js")).count);`,
        project.pick([
          `mock.module("@helpers/math.ts", () => ({ add: () => "mocked by the alias", twice: () => ${k}, thrice: () => 0, default: () => 0 }));`,
          `mock.module("./helpers/math.ts", () => ({ add: () => "mocked by the path", twice: () => ${k}, thrice: () => 0, default: () => 0 }));`,
          `const spy = spyOn(aliased, "add").mockReturnValue(${k});`,
        ]),
        `note("behind it", aliased.add(1, 1), math.add(1, 1), (await import("@helpers/math.ts")).add(1, 1), (await import("./helpers/math.ts")).add(1, 1), uses.doubled(1)); mock.restore();`,
      ],
    }),
    () => ({
      kind: "a mock that keeps a part",
      isAsync: true,
      needs: ["uses"],
      lines: [
        project.pick([
          `const actual${any} = await import("./helpers/math.ts"); const kept = { ...actual };`,
          `const kept${any} = { ...require("./helpers/math.ts") };`,
        ]),
        project.pick([
          `mock.module("./helpers/math.ts", () => ({ ...kept, add: mock((a${any}, b${any}) => kept.add(a, b) + ${k}) }));`,
          `mock.module("./helpers/math.ts", async () => { await null; return { ...kept, twice: () => ${k} }; });`,
          `mock.module("./helpers/math.ts", () => ({ ...kept, default: () => "only the default" }));`,
        ]),
        `const mocked${any} = await import("./helpers/math.ts"); note("partly", mocked.add(1, 2), mocked.twice(3), mocked.thrice(1), mocked.default(2), uses.doubled(2), Object.keys(mocked).sort().join());`,
        `mock.module("./helpers/math.ts", () => kept); note("mocked again", (await import("./helpers/math.ts")).add(1, 2), uses.doubled(2));`,
      ],
    }),
    () => ({
      kind: "a module that is not there is mocked",
      isAsync: true,
      needs: [],
      lines: [
        `mock.module("${project.pick(["./helpers/not-on-disk.js", "no-such-package", "@helpers/not-on-disk.ts"])}", () => ({ default: ${k}, name: "made up" }));`.replace(
          /^/,
          "",
        ),
        `for (const name of ["./helpers/not-on-disk.js", "no-such-package", "@helpers/not-on-disk.ts"]) { try { const made${any} = await import(name); note(name, made.default, made.name); } catch (error${any}) { note(name, error.name); } }`,
      ],
    }),
    () => ({
      kind: "a child process",
      needs: [],
      lines: [
        `const run = (...given${isTypeScript ? ": string[]" : ""}) => { const ended = Bun.spawnSync([process.execPath, ...given], { cwd: import.meta.dir, env: { ...process.env, FROM_THE_TEST: "${k}" } }); return [ended.exitCode, ended.stdout.toString().trim(), ended.stderr.toString().trim().split("\\n").at(-1)]; };`,
        `note("evaluated", run("-e", "console.log(1 + ${k}, process.env.FROM_THE_TEST, process.env.NODE_ENV)"));`,
        `note("a script", run("run", "./helpers/script.js", "given"), run("./helpers/script.js"));`,
        `note("this process", process.argv.length > 1, typeof process.execPath, process.env.NODE_ENV, Bun.env.NODE_ENV, typeof Bun.main, process.title.length > 0);`,
      ],
    }),
    () => ({
      kind: "files and a server",
      isAsync: true,
      needs: [],
      lines: [
        `const path = process.env.SEEN_IN + "/written-${k}-" + import.meta.file + ".txt"; await Bun.write(path, "written ${k}"); note("a file", await Bun.file(path).text(), Bun.file(path).size, await Bun.file(path + ".none").exists());`,
        `note("beside the test", (await Bun.file(import.meta.dir + "/helpers/data.json").json()).value, (await import("./helpers/data.json")).default.value, require("./helpers/data.json").list.length, (await import("./helpers/words.txt")).default.trim());`,
        `const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: request => new Response("served " + new URL(request.url).pathname) });`,
        `try { note("served", await (await fetch("http://127.0.0.1:" + server.port + "/p${k}")).text()); } catch (error${any}) { note("no answer", error.name); } finally { server.stop(true); }`,
      ],
    }),
    () => ({
      kind: "how the process is to end",
      needs: [],
      lines: [
        project.pick([
          `process.exitCode = ${k}; note("set", process.exitCode);`,
          `process.on("exit", () => {}); note("listens", process.listenerCount("exit") > 0);`,
          `note("as it is", process.exitCode, process.env.NODE_ENV, typeof process.send);`,
        ]),
      ],
    }),
    () => ({
      kind: "what TypeScript adds",
      needs: [],
      imports: [`import { Level, Names, describeLevel, Base, Kept, isKept } from "./helpers/typed.ts";`],
      lines: [
        `note("enums", Level.High, Level[2], Names.First, describeLevel(Level.Low), describeLevel(${k}${isTypeScript ? " as any" : ""}), Object.keys(Level).join());`,
        `class Mine extends Base { name() { return "mine ${k}"; } } const kept = new Kept(${k}); note("classes", new Mine().hello(), kept.hello(), kept.size, isKept(kept), isKept(new Mine()), isKept(null), Kept.count);`,
      ],
    }),
    () => ({
      kind: "the time zone",
      needs: ["builtins"],
      lines: [
        `note("as it is", new Date(0).getTimezoneOffset(), Intl.DateTimeFormat().resolvedOptions().timeZone, process.env.TZ, new Date(${k}e11).toString().slice(0, 33), new Date(${k}e11).toLocaleString("en-US"), new Date(2020, 0, ${k}).getTime());`,
        ...(project.chance(50)
          ? [
              `process.env.TZ = "${project.pick(["America/New_York", "Asia/Tokyo", "Europe/Berlin"])}"; note("set by the test", new Date(0).getTimezoneOffset(), new Date(${k}e11).getHours(), new Date(2020, 6, ${k}).getTime());`,
            ]
          : []),
      ],
    }),
    () => ({
      kind: "a stack that overflows",
      needs: ["math", "counters"],
      lines: [
        `const asked${isTypeScript ? ": [string, () => unknown][]" : ""} = [["itself", function deep(n${any} = 0)${any} { return deep(n + 1) + 1; }], ["through a helper", function through(n${any} = 0)${any} { return math.add(through(n + 1), 1); }], ["a getter", () => { const o${any} = { get again() { return this.again; } }; return o.again; }], ["toString", () => { const o${any} = { toString() { return "" + this; } }; return String(o); }], ["a nested list", () => { let list${any} = []; for (let i = 0; i < 200000; i++) list = [list]; return JSON.stringify(list).length; }], ["a constructor", () => { class Again { constructor() { new Again(); } } return new Again(); }]];`,
        `for (const [name, ask] of ${project.chance(50) ? "asked" : "asked.reverse()"}) { try { ask(); note(name, "no error"); } catch (error${any}) { note(name, error.name, error instanceof RangeError); } }`,
        `note("goes on", math.twice(${k}), counters.make(1).next());`,
      ],
    }),
    () => ({
      kind: "a helper is loaded behind the mock",
      isAsync: true,
      needs: [],
      lines: [
        project.pick([
          `mock.module("./helpers/math.ts", () => ({ add: (a${any}, b${any}) => "mocked " + a + b, twice: () => ${k}, thrice: () => 0, default: () => 0 }));`,
          `mock.module("./helpers/state.js", () => ({ bump: () => "mocked", count: -${k}, table: { rows: [] }, size: () => -1, loadedAs: "mocked" }));`,
          `mock.module("tiny-pkg", () => ({ greet: () => "mocked", version: "${k}", default: {} }));`,
        ]),
        `const late${any} = await import("./helpers/late.js"); note("loaded late", late.sum(1, 2), late.next(), late.hello(), late.seenWhenLoaded);`,
        `mock.restore(); const again${any} = await import("./helpers/late.js"); note("once more", again === late, again.sum(1, 2), again.next());`,
      ],
    }),
    () => ({
      kind: "matchers of its own",
      needs: ["math"],
      lines: [
        `expect.extend({ toBeTwice(received${any}, of${any}) { const pass = received === math.twice(of); return { pass, message: () => "expected " + received + (pass ? " not" : "") + " to be twice " + of }; } });`,
        `(expect(${2 * k})${isTypeScript ? " as any" : ""}).toBeTwice(${k}); (expect(${k})${isTypeScript ? " as any" : ""}).not.toBeTwice(${k}); try { (expect(1)${isTypeScript ? " as any" : ""}).toBeTwice(${k}); } catch (error${any}) { note("failed", error.message.split("\\n").at(-1)); }`,
        `expect({ a: ${2 * k} }).toEqual({ a: (expect${isTypeScript ? " as any" : ""}).toBeTwice(${k}) });`,
      ],
    }),
    () => ({
      kind: "a built-in is replaced under a computed name",
      needs: ["builtins"],
      lines: [
        `let got${any};`,
        ...project.pick([
          [
            `for (const name of ["${name}"]) { const spy = spyOn(${holder}${isTypeScript ? " as any" : ""}, name).mockImplementation(${replacement}); try { got = [${here}, ${there}]; } finally { spy.mockRestore(); } }`,
          ],
          [
            `const stub = (holder${any}, name${any}, made${any}) => spyOn(holder, name).mockImplementation(made);`,
            `const spy = stub(${holder}, "${name}", ${replacement}); try { got = [${here}, ${there}]; } finally { spy.mockRestore(); }`,
          ],
          [
            `((name${any}) => { const spy = spyOn(${holder}${isTypeScript ? " as any" : ""}, name).mockImplementation(${replacement}); try { got = [${here}, ${there}]; } finally { spy.mockRestore(); } })("${name}");`,
          ],
          [
            `for (const holder of [${holder}]${isTypeScript ? " as any[]" : ""}) { const spy = spyOn(holder, "${name}").mockImplementation(${replacement}); try { got = [${here}, ${there}]; } finally { spy.mockRestore(); } }`,
          ],
          [
            `for (const name of ["${name}"]) { const holder${any} = ${holder}; const real = holder[name]; holder[name] = ${replacement}; try { got = [${here}, ${there}]; } finally { holder[name] = real; } }`,
          ],
        ]),
        `note("${holder}.${name} replaced", got); note("put back", typeof (${here}), typeof (${there}));`,
      ],
    }),
    () => ({
      kind: "an export is replaced under a computed name",
      needs: ["math", "uses", "counters"],
      lines: [
        `const stub = (holder${any}, name${any}) => spyOn(holder, name).mockImplementation(() => ${k});`,
        ...project.pick([
          [`const spies = ["add", "twice"].map(name => stub(math, name));`],
          [`const spies = Object.keys(math).filter(name => name !== "default").map(name => stub(math, name));`],
          [`const spies = [stub(counters.Counter.prototype, ["ne", "xt"].join("")), stub(counters.Counter, "reset")];`],
          [
            `const spies${any} = []; for (const [holder, name] of [[math, "add"], [counters.shared, "next"], [uses, "doubled"]]${isTypeScript ? " as any[]" : ""}) spies.push(stub(holder, name));`,
          ],
        ]),
        `try { note("replaced", math.add(1, 1), math.twice(1), math.thrice(1), uses.doubled(1), uses.stepped(), counters.make(1).next(), counters.shared.next()); } finally { for (const spy of spies) spy.mockRestore(); }`,
        `note("put back", math.add(1, 1), math.thrice(1), uses.doubled(1), counters.make(1).next());`,
      ],
    }),
    () => ({
      kind: "a test that ends in an error",
      needs: ["math"],
      lines: [
        `note("reached", math.add(${k}, ${k}));`,
        project.pick([
          `throw new RangeError("thrown by the test ${k}");`,
          `(undefined${isTypeScript ? " as any" : ""}).member;`,
          `expect(math.twice(${k})).toBe(-1);`,
          `math.add(1n${isTypeScript ? " as any" : ""}, 1);`,
        ]),
      ],
    }),
  ])();
}

function writeTestFile(project: Project, name: string) {
  const isTypeScript = /\.(ts|mts|tsx)$/.test(name);
  const any = isTypeScript ? ": any" : "";
  const tests = project.several(2, 6, () => drawTest(project, isTypeScript));
  const needs = new Set(tests.flatMap(test => test.needs));
  const mocksAtTheTop = project.chance(12);
  const hooks = project.chance(35);
  // What every file begins with is in every run: a fault of test files that import no built-in module by a statement was never met while all of them began with an import of node:fs.
  const storesBy = project.bare
    ? "Bun.write"
    : project.pick(["node:fs", "node:fs", "Bun.write", "Bun.write", "require"]);
  const lines = [
    ...(isTypeScript && project.chance(50) ? ["// @ts-nocheck"] : []),
    `import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, jest, mock, spyOn, test } from "bun:test";`,
    ...(storesBy === "node:fs" ? [`import { writeFileSync } from "node:fs";`] : []),
    ...[...needs].map(need => helpers[need]),
    ...new Set(tests.flatMap(test => test.imports ?? [])),
    `const store = ${storesBy === "node:fs" ? "writeFileSync" : storesBy === "Bun.write" ? "Bun.write" : `(path${any}, text${any}) => require("node:fs").writeFileSync(path, text)`}, asText = JSON.stringify, isList = Array.isArray, joinOf = Array.prototype.join, mapOf = Array.prototype.map;`,
    `const seen${isTypeScript ? ": string[]" : ""} = [];`,
    `const leftReplaced${isTypeScript ? ": (() => unknown)[]" : ""} = [];`,
    `const show = (value${any})${isTypeScript ? ": string" : ""} => typeof value === "function" ? "function " + value.name : typeof value === "bigint" ? value + "n" : typeof value === "symbol" ? "symbol" : value === undefined ? "undefined" : Object.is(value, -0) ? "-0" : value instanceof Error ? value.name + ": " + value.message : isList(value) ? "[" + joinOf.call(mapOf.call(value, show), ",") + "]" : typeof value === "object" && value !== null ? asText(value) : String(value);`,
    `const note = (label${isTypeScript ? ": string" : ""}, ...values${isTypeScript ? ": unknown[]" : ""}) => { seen.push(label + ": " + joinOf.call(mapOf.call(values, show), " ")); };`,
    `afterAll(async () => { for (const ask of leftReplaced) { try { note("left replaced", ask()); } catch (error) { note("left replaced", error); } } await store(process.env.SEEN_IN + "/${name}.json", asText(seen, null, 1)); });`,
    ...(mocksAtTheTop && needs.has("math")
      ? [
          `mock.module("./helpers/math.ts", () => ({ add: () => "mocked at the top", twice: () => "mocked at the top", thrice: () => 0, default: () => 0 }));`,
        ]
      : []),
    ...(hooks
      ? [
          `beforeAll(() => note("beforeAll"));`,
          `beforeEach(() => note("beforeEach"));`,
          `afterEach(() => note("afterEach"));`,
        ]
      : []),
  ];
  if (project.chance(10))
    lines.push(`await new Promise(resolve => setTimeout(resolve, 1)); note("waited while the file was loaded");`);
  const inDescribe = project.chance(30);
  if (inDescribe)
    lines.push(`describe("a group", () => {`, ...(hooks ? [`beforeEach(() => note("beforeEach of the group"));`] : []));
  tests.forEach((drawn, index) => {
    const how = project.pick([
      "test",
      "test",
      "test",
      "test",
      "test",
      "test",
      "test.skip",
      "test.todo",
      "test.failing",
      "test.if(true)",
      "test.if(false)",
    ]);
    lines.push(
      `${how}("${drawn.kind} ${index}", ${drawn.isAsync ? "async " : ""}() => {`,
      `  note("${drawn.kind} ${index}");`,
      ...drawn.lines.map(line => "  " + line),
      `}${drawn.options && how === "test" ? ", " + drawn.options : ""});`,
    );
  });
  if (project.chance(20))
    lines.push(
      `test.each([[1, 2, 3], [2, 3, 5], [${project.below(5)}, 1, 2]])("each %i", (a${any}, b${any}, sum${any}) => { note("each", a, b); expect(a + b).toBe(sum); });`,
    );
  if (inDescribe) lines.push("});");
  if (project.chance(50)) {
    // Only the names of bun:test that the file uses.
    const at = lines.findIndex(line => line.endsWith(`from "bun:test";`));
    const rest = lines.filter((_, index) => index !== at).join("\n");
    const used = [
      "afterAll",
      "afterEach",
      "beforeAll",
      "beforeEach",
      "describe",
      "expect",
      "jest",
      "mock",
      "spyOn",
      "test",
    ].filter(word => new RegExp(`\\b${word}\\b`).test(rest));
    lines[at] = `import { ${used.join(", ")} } from "bun:test";`;
  }
  // A helper of Bun's own tests takes them so. One such file cost its neighbours node:vm's runInContext for three hours, and no drawn file had it.
  if (project.chance(10)) {
    const at = lines.findIndex(line => line.endsWith(`from "bun:test";`));
    lines[at] = lines[at].replace(/^import (\{.*\}) from "bun:test";$/, `const $1 = Bun.jest(import.meta.path);`);
  }
  project.files.set(name, lines.join("\n") + "\n");
}

/** A program of the ordinary scenes as a test file: it runs while the file is loaded, and one test stores what it printed. */
function writeSceneFile(project: Project, name: string) {
  const isTypeScript = name.endsWith(".ts");
  const first = "const printValue = console.log;\n";
  const program = writeOrdinaryScenes(first + `// ${project.seed} ${name}\n`, isTypeScript);
  const [main, ...otherFiles] = program.split(/^(?=\/\/ @filename: )/m);
  const folder = otherFiles.length ? name.replace(/\.test\.\w+$/, "") + "/" : "";
  for (const file of otherFiles) {
    const [, path, text] = /^\/\/ @filename: (.*)\n([^]*)$/.exec(file)!;
    project.files.set(folder + path.replace(/^\.?\//, ""), text);
  }
  const body = main.slice(first.length).replace(/^export \{\};\n/m, "");
  const imports = body.split("\n").filter(line => /^import /.test(line));
  const others = body
    .split("\n")
    .filter(line => !/^import /.test(line))
    .join("\n");
  project.files.set(
    folder + name,
    [
      ...(isTypeScript ? ["// @ts-nocheck"] : []),
      `import { expect, test } from "bun:test";`,
      `import { writeFileSync } from "node:fs";`,
      ...imports,
      `const store = writeFileSync, asText = JSON.stringify;`,
      `const printed = [];`,
      `const printValue = (...values) => { printed.push(values.map(value => (typeof value === "string" ? value : typeof value === "object" && value !== null ? asText(value) : String(value))).join(" ")); };`,
      others,
      `test("an ordinary scene 0", async () => { await new Promise(resolve => setTimeout(resolve, 20)); store(process.env.SEEN_IN + "/${name}.json", asText(printed, null, 1)); expect(printed.length).toBeGreaterThan(0); });`,
      "",
    ].join("\n"),
  );
}

function writeFileThatDoesNotRun(project: Project, name: string) {
  const good = `import { expect, test } from "bun:test";\ntest("a file that does not run 0", () => { expect(1).toBe(1); });\n`;
  project.pick([
    () => project.files.set(name, good + "const broken = ;\n"),
    () => project.files.set(name, good + `import "./helpers/missing.js";\n`),
    () => {
      project.files.set("helpers/broken.js", "export const value = 1;\nexport const broken = ;\n");
      project.files.set(name, `import { value } from "./helpers/broken.js";\n` + good + "console.log(value);\n");
    },
    () => project.files.set(name, good + `throw new Error("thrown while the file is loaded");\n`),
    () => {
      project.files.set(
        "helpers/throws.js",
        `export const value = 1;\nthrow new Error("thrown while a helper is loaded");\n`,
      );
      project.files.set(name, `import { value } from "./helpers/throws.js";\n` + good + "console.log(value);\n");
    },
    () =>
      project.files.set(
        name.replace(/\.js$/, ".ts"),
        good +
          `const wrong: number = "a text";\ntest("a file that does not run 1", () => { expect(typeof wrong).toBe("string"); });\n`,
      ),
  ])();
}

/** How a test file may be called. A fault has shown in a .js test file and not in a .ts one. */
const testFileEndings = [
  "test.js",
  "test.js",
  "test.js",
  "test.ts",
  "test.ts",
  "test.mjs",
  "test.mts",
  "test.tsx",
  "test.jsx",
  "spec.js",
  "spec.ts",
];

/** The drawn test files of a third of the projects lie in folders of several depths, as those of an application do; what they name by "./" is named from there. */
function scatter(project: Project) {
  if (!project.chance(35)) return;
  for (const [name, text] of [...project.files]) {
    if (!name.match(/\.(test|spec)\./) || name.includes("/") || !text.includes("const note = ")) continue;
    const folder = project.pick(["", "src/", "src/deep/", "tests/unit/", "src/deep/er/"]);
    if (!folder) continue;
    const up = "../".repeat(folder.split("/").length - 1);
    project.files.delete(name);
    project.files.set(
      folder + name,
      text
        .replace(/(["'`])\.\//g, (_, quote) => quote + up)
        .replaceAll("import.meta.dir", `(import.meta.dir + "/${up}.")`),
    );
  }
}

/** A drawn file that does not parse fails to load in plain and compiled alike: the two runs agree, and every test of the file tests nothing. Only the files that are broken on purpose may. */
function draw(seed: string) {
  const project = drawFiles(seed);
  for (const [name, text] of project.files) {
    const loader =
      /\.(tsx|jsx)$/.exec(name)?.[1] ?? (/\.[cm]?ts$/.test(name) ? "ts" : /\.[cm]?js$/.test(name) ? "js" : "");
    if (!loader || text.includes("const broken = ;")) continue;
    try {
      new Bun.Transpiler({ loader: loader as "js" }).transformSync(text);
    } catch (error: any) {
      throw new Error(
        `the generator wrote a file that does not parse: ${name} of the project ${seed}: ${String(error?.errors?.[0]?.message ?? error?.message ?? error).slice(0, 120)}`,
      );
    }
  }
  return project;
}

function drawFiles(seed: string) {
  const project = new Project(seed);
  writeHelpers(project);
  project.graph = writeGraph(project);
  // One mention of a built-in module anywhere in a piece has cured a fault of the whole piece, so a bare file among others is not enough: the whole project is bare.
  project.bare = options.bare || (!options.pure && options.only === "" && project.chance(12));
  if (project.bare) {
    project.onlyKind = "things of the realm are touched";
    const files = project.chance(25) ? 17 + project.below(8) : 2 + project.below(5);
    for (let index = 0; index < files; index++) writeTestFile(project, `file${index}.${project.pick(testFileEndings)}`);
    project.onlyKind = "";
    scatter(project);
    return project;
  }
  // What one test does widens what the build holds for the whole program, and covers a fault of another: one eval() anywhere admits node:vm's runInContext everywhere, one require of a module gives it a state of its own.
  // A project of fifty kinds never shows such a fault. A quarter of the projects are sparse: two or three kinds in all their files, and none of the files that every other project has.
  if (options.sparse || (!options.pure && options.only === "" && project.chance(25))) {
    const left = options.without.split(",");
    const kinds = new Set<string>();
    // With --only there may be fewer kinds to choose from than a sparse project takes.
    const allowed = options.only === "" ? 3 : options.only.split(",").filter(kind => !left.includes(kind)).length;
    for (const most = Math.min(2 + project.below(2), allowed); kinds.size < most; ) {
      const kind = drawAnyTest(project, false).kind;
      if (!left.includes(kind) && (options.only === "" || options.only.split(",").includes(kind))) kinds.add(kind);
    }
    project.sparse = [...kinds];
    const files = project.chance(15) ? 17 + project.below(8) : 2 + project.below(4);
    for (let index = 0; index < files; index++) writeTestFile(project, `file${index}.${project.pick(testFileEndings)}`);
    project.sparse = [];
    scatter(project);
    return project;
  }
  project.opensTheModules = !options.pure && project.chance(45);
  if (project.opensTheModules)
    project.files.set(
      "opens-the-modules.test.js",
      `import { expect, test } from "bun:test";\ntest("a name that no build can know", async () => { expect((await import(${project.pick([`"./helpers/unrelated.js?t=" + Date.now()`, `process.env.NOBODY_SETS_THIS ?? "./helpers/unrelated.js"`, `"./helpers/unrelated.js?" + Math.random()`])})).unrelated).toBe(1); });\n`,
    );
  // A copy meets a compiled helper only where the build has compiled it: where some file of the run names the module without a query. This file does, and no test of the kind is in it.
  project.files.set(
    "names-the-copies.test.js",
    `import { expect, test } from "bun:test";\ntest("the modules that are copied elsewhere", async () => { for (const load of [() => import("./helpers/copied-star.js"), () => import("./helpers/copied-named.js"), () => import("./helpers/copied-namespace.js"), () => import("./helpers/copied-uses.js"), () => import("./helpers/copied-requires.cjs")]) expect(typeof (await load())).toBe("object"); });\n`,
  );
  const count = project.chance(8) ? 12 + project.below(20) : 2 + project.below(5);
  for (let index = 0; index < count; index++) {
    const name = `file${index}.test.${project.pick(["js", "js", "ts"])}`;
    const which = project.below(100);
    if (which < 12 && !options.pure) writeFileThatDoesNotRun(project, `file${index}.test.js`);
    else if (which < 34 && !options.pure) writeSceneFile(project, name);
    else writeTestFile(project, `file${index}.${project.pick(testFileEndings)}`);
  }
  // One kind of fifty is seldom the first of its file, and this one bites only there: it has a file of its own in every project.
  const copies = "a copy over a helper that may not have run";
  if (
    !options.without.split(",").includes(copies) &&
    (options.only === "" || options.only.split(",").includes(copies))
  ) {
    project.onlyKind = copies;
    writeTestFile(project, "copies.test.js");
    project.onlyKind = "";
  }
  // This one has shown only in the FIRST test file of an image: its file sorts in front of the others in half the projects.
  const fromDisk = "a copy from disk over a helper that is only resolved";
  if (
    !options.without.split(",").includes(fromDisk) &&
    (options.only === "" || options.only.split(",").includes(fromDisk))
  ) {
    project.onlyKind = fromDisk;
    writeTestFile(project, project.chance(50) ? "a-first.test.js" : "from-disk.test.js");
    project.onlyKind = "";
  }
  scatter(project);
  project.files.set(
    "timings.json",
    JSON.stringify(
      Object.fromEntries(
        [...project.files.keys()]
          .filter(name => name.match(/\.(test|spec)\./))
          .map(name => [name, project.below(3000)]),
      ),
    ) + "\n",
  );
  return project;
}

type Ended = {
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  stderr: string;
  cases: Map<string, string>;
  seen: Map<string, string>;
};

if ((options.reduce || options.project) && options.words.includes(":drawn"))
  throw new Error("--words: say the number that the report of the find says");
const wordsOfTheRun: Record<string, string> = options.words ? { BUN_DEBUG_TEST_AOT_WORDS: options.words } : {};

function runTests(
  bun: string,
  folder: string,
  flags: string[],
  label: string,
  more: Record<string, string> = {},
): Ended {
  const seenIn = join(folder, "..", "seen-" + label);
  rmSync(seenIn, { recursive: true, force: true });
  mkdirSync(seenIn, { recursive: true });
  const report = join(seenIn, "report.xml");
  const ended = Bun.spawnSync({
    // A long limit for each test: on a busy machine a child process took more than the usual five seconds now and then, in either mode. A test about limits has one of its own.
    cmd: [bun, "test", ...flags, "--timeout=30000", "--reporter=junit", "--reporter-outfile=" + report],
    cwd: folder,
    env: { ...process.env, SEEN_IN: seenIn, BUN_ENABLE_CRASH_REPORTING: "0", NO_COLOR: "1", LEFT_BEHIND: "", ...more },
    stdout: "pipe",
    stderr: "pipe",
    timeout: Number(options["ends-within"]) * 1000,
    killSignal: "SIGKILL",
  });
  const cases = new Map<string, string>();
  if (existsSync(report))
    // A case without a child has passed.
    for (const [, attributes, child] of readFileSync(report, "utf8").matchAll(
      /<testcase ([^>]*?)(?:\/>|>\s*<(\w+))/g,
    )) {
      const of = (name: string) => new RegExp(` ?${name}="([^"]*)"`).exec(attributes)?.[1] ?? "";
      const key = `${of("file")} | ${of("classname")} | ${of("name")}`;
      cases.set(key, `${child ?? "pass"} with ${of("assertions")} assertions`);
    }
  const seen = new Map<string, string>();
  for (const name of readdirSync(seenIn))
    if (name.endsWith(".json")) seen.set(name, readFileSync(join(seenIn, name), "utf8"));
  return {
    exitCode: ended.exitCode,
    signal: ended.signalCode == null ? null : String(ended.signalCode),
    timedOut: ended.exitedDueToTimeout === true,
    stderr: ended.stderr.toString() + ended.stdout.toString(),
    cases,
    seen,
  };
}

const known = options.known.split(",").filter(Boolean);
const isKnown = (kind: string) => known.includes(kind);
/** What a file saw, without what tests of a known kind saw. A test begins with a line of its kind and number. */
function withoutKnown(lines: string[]) {
  let isLeftOut = false;
  return lines.filter(line => {
    const kind = /^([a-zA-Z. ]+?) \d+: $/.exec(line)?.[1];
    if (kind !== undefined) isLeftOut = isKnown(kind);
    return !isLeftOut;
  });
}

/** The first thing in which two runs differ: [the kind of the difference, the kind of the test, the words]. */
/** The thing at which a test that touches things of the realm parts from plain: the first note of the test that the other run lacks or has otherwise. */
function findThingOfRealm(key: string, plain: Ended, other: Ended) {
  const [file, , test] = key.split(" | ");
  const notesOf = (run: Ended) => {
    const all: string[] = JSON.parse(run.seen.get(file.trim().split("/").at(-1) + ".json") ?? "[]");
    const from = all.indexOf((test ?? "").trim() + ": ");
    if (from < 0) return [];
    const rest = all.slice(from + 1);
    const to = rest.findIndex(line => /^[^:]+ \d+: $/.test(line));
    return to < 0 ? rest : rest.slice(0, to);
  };
  const [ours, theirs] = [notesOf(plain), notesOf(other)];
  return /^([^:]+): /
    .exec(ours.find((line, index) => line !== theirs[index]) ?? "")?.[1]
    ?.replace(/[^a-zA-Z0-9.$ ]/g, " ");
}

function difference(plain: Ended, other: Ended): [string, string, string] | undefined {
  const kindOf = (key: string) => (/\| ([^|]*?) \d+$/.exec(key)?.[1] ?? key.split(" | ").at(-1)!).trim();
  if (other.timedOut && !plain.timedOut)
    return ["never ends", "", `the run was ended behind ${options["ends-within"]} s`];
  const crash =
    /^.*(panic|Segmentation fault|ASSERTION FAILED|Illegal instruction|AOT validation|AOT: |which the compiler assumed).*$/m.exec(
      other.stderr,
    )?.[0];
  if ((other.signal && !plain.signal) || (crash && !plain.stderr.includes(crash)))
    return ["crash", "", `${other.signal ?? ""} ${crash ?? ""}`.trim()];
  for (const key of [...new Set([...plain.cases.keys(), ...other.cases.keys()])].sort())
    if (plain.cases.get(key) !== other.cases.get(key) && !isKnown(kindOf(key)))
      return [
        "a test ends otherwise",
        // Filed by the thing, as where a test sees otherwise: a server that stalls on a busy machine would else stand for all 185.
        (kindOf(key) === "things of the realm are touched" &&
          findThingOfRealm(key, plain, other)?.replace(/^/, "the realm's ")) ||
          kindOf(key),
        `${key}: plain ${plain.cases.get(key) ?? "is not run"}, the other ${other.cases.get(key) ?? "is not run"}`,
      ];
  for (const name of [...new Set([...plain.seen.keys(), ...other.seen.keys()])].sort()) {
    const [ours, theirs] = [other.seen.get(name), plain.seen.get(name)];
    if (ours === theirs) continue;
    if (ours === undefined || theirs === undefined)
      return [
        "a file stores nothing",
        "",
        `${name}: ${ours === undefined ? "the other run" : "the plain run"} stored nothing`,
      ];
    const [a, b] = [withoutKnown(JSON.parse(theirs)), withoutKnown(JSON.parse(ours))];
    if (a.join("\n") === b.join("\n")) continue;
    // Plain Bun prints the text of a function as its transpiler writes it, a compiled run as the source has it: they differ in white space.
    const bare = (line: string | undefined) => line?.replace(/\\n|\s+/g, "");
    if (a.length === b.length && a.every((line, index) => bare(line) === bare(b[index]))) continue;
    const at = a.findIndex((line, index) => bare(line) !== bare(b[index]));
    const where = at < 0 ? a.length : at;
    let kind = "";
    for (let index = Math.min(where, a.length - 1); index >= 0 && !kind; index--)
      kind = /^([^:]+?) \d+: $/.exec(a[index])?.[1] ?? "";
    // One kind touches 185 things: its finds are filed by the thing, so that one thing with a known fault hides no other.
    if (kind === "things of the realm are touched")
      kind =
        "the realm's " +
        (/^([^:]+): /.exec(a[where] ?? b[where] ?? "")?.[1] ?? "things").replace(/[^a-zA-Z0-9.$ ]/g, " ");
    return [
      "a test sees otherwise",
      // What a scene prints begins with the scene's own words and a number: finds are filed by scene, so that one scene with a known fault does not fill the five places of all.
      kind ||
        (name.includes("file")
          ? "a scene of " + (/^([a-zA-Z][a-zA-Z -]*?) \d+\b/.exec(a[where] ?? b[where] ?? "")?.[1] ?? "another kind")
          : ""),
      `${name} line ${where}: plain ${JSON.stringify(a[where])}, the other ${JSON.stringify(b[where])}`,
    ];
  }
  if ((plain.exitCode === 0) !== (other.exitCode === 0))
    return ["the run ends otherwise", "", `exit codes ${plain.exitCode} and ${other.exitCode}`];
}

if (options["only-write"]) {
  for (const [name, text] of draw(options.seed).files) {
    mkdirSync(dirname(join(options["only-write"], name)), { recursive: true });
    writeFileSync(join(options["only-write"], name), text);
  }
  process.exit(0);
}

if (options.reduce) {
  const report = readFileSync(join(options.reduce, "report.txt"), "utf8");
  const flags = /test --aot (.*?)\s+\(in project/.exec(report)![1].split(" ").filter(Boolean);
  const [what, kind = ""] = report.split("\n")[0].split(": ");
  const root = join(options.work, "project");
  let files = new Map<string, string[]>();
  const read = (folder: string, prefix: string) => {
    for (const entry of readdirSync(folder, { withFileTypes: true }))
      if (entry.isDirectory()) read(join(folder, entry.name), prefix + entry.name + "/");
      else if (!prefix.includes("__snapshots__"))
        files.set(prefix + entry.name, readFileSync(join(folder, entry.name), "utf8").split("\n"));
  };
  read(join(options.reduce, "project"), "");
  let asked = 0;
  const holds = (candidate: Map<string, string[]>) => {
    asked++;
    rmSync(options.work, { recursive: true, force: true });
    for (const [name, lines] of candidate) {
      mkdirSync(dirname(join(root, name)), { recursive: true });
      writeFileSync(join(root, name), lines.join("\n"));
    }
    const plain = runTests(options.bun, root, flags, "plain");
    if (plain.timedOut) return false;
    const compiled = runTests(options.bun, root, ["--aot", ...flags], "compiled", wordsOfTheRun);
    if (options.must) return compiled.stderr.includes(options.must) && !plain.stderr.includes(options.must);
    const found = difference(plain, compiled);
    return found !== undefined && found[0] === what && found[1] === kind;
  };
  if (!holds(files)) {
    console.log("the find does not differ in that way as it is: nothing is reduced");
    process.exit(1);
  }
  const sizeOf = () => [...files.values()].reduce((sum, lines) => sum + lines.length, 0);
  for (let before = Infinity; sizeOf() < before; ) {
    before = sizeOf();
    for (const name of [...files.keys()]) {
      const candidate = new Map(files);
      candidate.delete(name);
      if (holds(candidate)) files = candidate;
    }
    for (const name of [...files.keys()])
      for (let size = Math.ceil(files.get(name)!.length / 2); size >= 1; size = size === 1 ? 0 : Math.ceil(size / 2))
        for (let at = 0; at < files.get(name)!.length; ) {
          const lines = files.get(name)!;
          const candidate = new Map(files).set(name, [...lines.slice(0, at), ...lines.slice(at + size)]);
          if (holds(candidate)) files = candidate;
          else at += size;
        }
    console.log(new Date().toISOString().slice(11, 19), `${files.size} files, ${sizeOf()} lines, ${asked} asked`);
  }
  const into = join(options.reduce, "reduced");
  rmSync(into, { recursive: true, force: true });
  for (const [name, lines] of files) {
    mkdirSync(dirname(join(into, name)), { recursive: true });
    writeFileSync(join(into, name), lines.join("\n"));
  }
  rmSync(options.work, { recursive: true, force: true });
  process.exit(0);
}

if (options.project) {
  const root = join(options.work, "project");
  rmSync(options.work, { recursive: true, force: true });
  cpSync(options.project, root, { recursive: true });
  const flags = (options.flags || "--isolate --parallel=4").split(" ").filter(Boolean);
  const found = difference(
    runTests(options.bun, root, flags, "plain"),
    runTests(options.bun, root, ["--aot", ...flags], "compiled", wordsOfTheRun),
  );
  console.log(found ? found.join(" | ") : "the same");
  rmSync(options.work, { recursive: true, force: true });
  process.exit(found ? 1 : 0);
}

const counts: Record<string, number> = {};
const add = (name: string) => void (counts[name] = (counts[name] ?? 0) + 1);
const until = Date.now() + Number(options.seconds) * 1000;
const flagsDrawn = options.flags
  ? [options.flags]
  : // Not --parallel with --no-isolate: which files share a worker, and so each other's mocks, goes by the clock.
    // Not without --isolate either: what one file does to a module shows in the next, so one fault is found in every file behind it.
    [
      "--isolate --parallel=4",
      "--isolate --parallel=4",
      "--isolate --parallel=4",
      "--isolate --parallel=4",
      "--isolate --parallel=2",
      "--isolate --parallel=8",
      "--isolate --parallel=24",
      "--isolate",
      "--isolate --parallel=4 --randomize --seed=7",
      "--isolate --parallel=4 -t a",
      "--isolate --parallel=4 --timings=timings.json",
      "--isolate --parallel=2 --timings=timings.json",
    ];
mkdirSync(options.finds, { recursive: true });
for (let number = 0; Date.now() < until && (options.projects === "0" || number < Number(options.projects)); number++) {
  const seed = `${options.seed}-${number}`;
  const project = draw(seed);
  const root = join(options.work, "project");
  rmSync(options.work, { recursive: true, force: true });
  for (const [name, text] of project.files) {
    mkdirSync(dirname(join(root, name)), { recursive: true });
    writeFileSync(join(root, name), text);
  }
  const flags = flagsDrawn[project.below(flagsDrawn.length)].split(" ").filter(Boolean);
  // The preload is named in bunfig.toml or on the command line.
  if (project.files.has("bunfig.toml") && project.files.has("setup.ts") && project.chance(50)) {
    rmSync(join(root, "bunfig.toml"));
    flags.push("--preload", "./setup.ts");
  }
  // A shard of a suite names its test files: the others lie beside them and are no part of the run.
  if (project.chance(25)) {
    const all = [...project.files.keys()].filter(name => name.match(/\.(test|spec)\./));
    const named = all.filter(() => project.chance(60));
    flags.push(...(named.length ? named : all.slice(0, 1)).map(name => "./" + name));
  }
  const plain = runTests(options.bun, root, flags, "plain");
  const again = runTests(options.bun, root, flags, "plain-again");
  add("projects");
  if (difference(plain, again) || plain.timedOut) {
    add("plain bun test answers itself otherwise");
    continue;
  }
  // A compiled run answers as plain does whatever the order in which flow's rules run: a layer once lost a function's body by that order alone. A word that does not begin with TestRun goes to the engine; the number of a schedule is a byte.
  const schedule = project.chance(30)
    ? project.pick([
        "testing=DelayFlowRules",
        "testing=DelayOtherFlowRules",
        `testing=DelayFlowRules:${1 + project.below(255)}`,
        `testing=DelayFlowRules:${1 + project.below(20)}`,
      ])
    : "";
  // How many test files share a piece decides what one build sees together: an export behind a computed name lost its body in every run where two test files or more stood in one piece, and in some runs with pieces of one.
  const form = options.words.replace("TestRunPartFiles:drawn", `TestRunPartFiles:${project.pick([1, 2, 3, 16])}`);
  const wordsOfTheRun: Record<string, string> =
    form || schedule ? { BUN_DEBUG_TEST_AOT_WORDS: [form, schedule].filter(Boolean).join(",") } : {};
  const compiled = runTests(options.bun, root, ["--aot", ...flags], "compiled", wordsOfTheRun);
  let found = difference(plain, compiled);
  // Once more with the checks of the run time on: they end a worker where something that the compiler relies on does not hold, also where the answer is right.
  if (!found && project.chance(50)) {
    const checked = runTests(options.bun, root, ["--aot", ...flags], "checked", {
      ...wordsOfTheRun,
      BUN_JSC_validateAOTRuntime: "1",
    });
    const reported = difference(plain, checked);
    if (reported) {
      found = ["under the checks of the run time " + reported[0], reported[1], reported[2]];
      compiled.stderr = checked.stderr;
    }
  }
  // Plain was asked twice; so is the compiled run where it differs. A difference that does not come again is kept apart: a busy machine makes them, and so may a race that only compiled code has.
  if (
    found &&
    !found[0].startsWith("under the checks") &&
    compiled.signal === null &&
    !/panic|Segmentation|SIGSEGV|SIGILL|SIGABRT|SIGTRAP/.test(compiled.stderr)
  ) {
    const second = runTests(options.bun, root, ["--aot", ...flags], "compiled-again", wordsOfTheRun);
    if (!difference(plain, second)) found = ["the compiled run wavers", found[1], found[2]];
  }
  add(found ? found[0] : "same");
  if (found) {
    const [what, kind, words] = found;
    const name =
      `${what} ${kind}`.trim().replace(/[^a-zA-Z0-9]+/g, "-") +
      (what === "crash" ? "-" + createHash("sha1").update(words.replace(/\d+/g, "_")).digest("hex").slice(0, 8) : "");
    const folder = join(options.finds, name);
    mkdirSync(folder, { recursive: true });
    const held = readdirSync(folder).length;
    if (held < 5) {
      const into = join(folder, `${seed}`);
      cpSync(options.work, into, { recursive: true });
      writeFileSync(
        join(into, "report.txt"),
        `${what}${kind ? ": " + kind : ""}\n${words}\n${options.bun} test --aot ${flags.join(" ")}   (in project/; plain: the same without --aot)\nBUN_DEBUG_TEST_AOT_WORDS=${wordsOfTheRun.BUN_DEBUG_TEST_AOT_WORDS ?? ""}\nseed ${seed}\nexit codes: plain ${plain.exitCode}, compiled ${compiled.exitCode} ${compiled.signal ?? ""}\n`,
      );
      writeFileSync(join(into, "plain.stderr"), plain.stderr);
      writeFileSync(join(into, "compiled.stderr"), compiled.stderr);
    }
  }
  if (number % 10 === 9) console.log(new Date().toISOString().slice(11, 19), JSON.stringify(counts));
}
console.log(new Date().toISOString().slice(11, 19), "ended", JSON.stringify(counts));
rmSync(options.work, { recursive: true, force: true });
