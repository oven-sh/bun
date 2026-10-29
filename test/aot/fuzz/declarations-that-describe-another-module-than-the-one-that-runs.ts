// Small programs in which TypeScript imports a module of JavaScript whose declarations describe it rightly, wrongly, in part, or as another version of it was. TypeScript reads the declarations alone and
// accepts every program. What runs is the JavaScript, so the executable prints what plain Bun prints. One thing is declared, one thing runs and one thing is done with it in a program. In this order are drawn:
//
//   what is said   a constant of a literal type; a constant that changes; a read-only object that changes; a function under another name, with other parameters, with an optional parameter that is needed; a class
//                  where a function is exported and a function where a class is; `value is T`, `asserts value is T`, `never`, `void`; overloads; generic functions; an enum and a `const enum` with other
//                  values; a promise where a value comes and a value where a promise comes; a list where something else can be walked; the fields of a class; a tuple; `this`; private members; a default
//                  export and `export =`; members that only an augmentation of the module or of a global interface declares
//   what runs      what is said, or one of several other things
//   where it lies  a declaration file beside the JavaScript; a package with "types", "typings", "exports", a file beside its main file, `index.d.ts`, typings under @types; `declare module` in the project;
//                  with more declarations in the file that are invalid, under `skipLibCheck`
//   the files      an ES module or a CommonJS file; a file of TypeScript between that exports it again; the use in the first file or in one more
//   the reach      by name, the namespace, the default of a CommonJS file, `import lib = require(..)`, `import()`
//   what is done   one of several things that the declarations allow, once or in a loop of ten thousand turns, with and without a `try` round it
import type { Random } from "./random";

/** In `uses` the module is `lib`. A use without `console.log` is an expression. The first of `runs` is what `says` describes. */
type Lie = {
  says: string;
  runs: string[];
  uses: string[];
  /** A name that only the declarations have cannot be imported by name. */
  onlyThroughTheWhole?: true;
  /** Written as a CommonJS file. `says` stands in a .d.cts. */
  isCommon?: true;
  /** How the whole is imported, where not every way fits. */
  reaches?: ("by name" | "the namespace" | "the default" | "import = require" | "import()")[];
  /** Lines for the file that uses it, ahead of everything. */
  declares?: string;
};

const lies: Record<string, Lie> = {
  "a text of a literal type": {
    says: `export declare const version: "1.0.0";`,
    runs: [
      `export const version = "1.0.0";`,
      `export const version = "2.0.0";`,
      "export const version = 1;",
      "export const version = null;",
      `export const version = ["1.0.0"];`,
      `export const version = new String("1.0.0");`,
    ],
    uses: [
      `lib.version === "1.0.0" ? "same" : "another"`,
      "lib.version.length",
      "`<${lib.version}>`",
      "typeof lib.version",
      `({ "1.0.0": "one" })[lib.version]`,
      `lib.version + "!"`,
      `switch (lib.version) {\ncase "1.0.0":\nconsole.log("one");\nbreak;\ndefault:\nconsole.log("another");\n}`,
      `const held: "1.0.0" = lib.version;\nconsole.log(held);`,
      `if (lib.version !== "1.0.0") console.log("another");\nelse console.log("same");`,
    ],
  },
  "a number of a literal type": {
    says: "export declare const limit: 5;",
    runs: [
      "export const limit = 5;",
      "export const limit = 6;",
      `export const limit = "5";`,
      "export const limit = 5.5;",
      "export const limit = undefined;",
      "export const limit = -0;",
      "export const limit = 5n;",
    ],
    uses: [
      "lib.limit + 1",
      "lib.limit === 5",
      "lib.limit * 2",
      "[0, 1, 2, 3, 4, 5, 6][lib.limit]",
      "lib.limit > 5",
      "typeof lib.limit",
      "`${lib.limit}`",
      "lib.limit | 0",
      "new Array(lib.limit).length",
      "let turns = 0;\nfor (let at = 0; at < lib.limit; at++) turns++;\nconsole.log(turns);",
      `switch (lib.limit) {\ncase 5:\nconsole.log("five");\nbreak;\ndefault:\nconsole.log("another");\n}`,
      "const held: 5 = lib.limit;\nconsole.log(held + held);",
    ],
  },
  "a boolean of a literal type": {
    says: "export declare const enabled: true;",
    runs: [
      "export const enabled = true;",
      "export const enabled = false;",
      "export const enabled = 0;",
      `export const enabled = "";`,
      "export const enabled = null;",
      "export const enabled = 1;",
    ],
    uses: [
      `lib.enabled ? "on" : "off"`,
      "lib.enabled === true",
      "!lib.enabled",
      "typeof lib.enabled",
      `lib.enabled && "on"`,
      `lib.enabled || "off"`,
      `if (!lib.enabled) console.log("off");\nelse console.log("on");`,
      `if (lib.enabled) console.log("on");\nconsole.log("behind");`,
      `while (!lib.enabled) {\nconsole.log("off");\nbreak;\n}\nconsole.log("behind");`,
    ],
  },
  "a constant that changes": {
    says: "export declare const count: number;\nexport declare function bump(): void;",
    runs: [
      "export const count = 1;\nexport function bump() {}",
      "export let count = 1;\nexport function bump() {\ncount++;\n}",
      `export let count = 1;\nexport function bump() {\ncount = "two";\n}`,
      "export let count = 1;\nexport function bump() {\ncount += 0.5;\n}",
      "export let count = 1;\nexport function bump() {\ncount = undefined;\n}",
    ],
    uses: [
      "console.log(lib.count);\nlib.bump();\nconsole.log(lib.count);",
      "const before = lib.count;\nlib.bump();\nconsole.log(before, lib.count, before === lib.count);",
      "console.log(lib.count + 1);\nlib.bump();\nconsole.log(lib.count + 1);",
      "for (let at = 0; at < 3; at++) lib.bump();\nconsole.log(lib.count);",
      "let summed = 0;\nfor (let at = 0; at < 3; at++) {\nsummed += lib.count;\nlib.bump();\n}\nconsole.log(summed);",
      "const read = () => lib.count;\nlib.bump();\nconsole.log(read());",
    ],
    reaches: ["by name", "the namespace"],
  },
  "a read-only object that changes": {
    says: "export declare const config: { readonly port: number; readonly tags: readonly string[] };\nexport declare function change(): void;",
    runs: [
      `export const config = { port: 80, tags: ["a"] };\nexport function change() {}`,
      `export const config = { port: 80, tags: ["a"] };\nexport function change() {\nconfig.port = 81;\n}`,
      `export const config = { port: 80, tags: ["a"] };\nexport function change() {\nconfig.port = "81";\n}`,
      `export const config = { port: 80, tags: ["a"] };\nexport function change() {\ndelete config.port;\n}`,
      `export const config = { port: 80, tags: ["a"] };\nexport function change() {\nconfig.tags.push("b");\n}`,
      `export const config = { port: 80, tags: ["a"] };\nexport function change() {\nconfig.tags = "ab";\n}`,
      `export const config = { port: 80, tags: ["a"] };\nexport function change() {\nObject.defineProperty(config, "port", { get() { return 82; } });\n}`,
      `export const config = { port: 80, tags: ["a"] };\nexport function change() {\nconfig.more = 1;\n}`,
    ],
    uses: [
      "console.log(lib.config.port);\nlib.change();\nconsole.log(lib.config.port);",
      "console.log(lib.config.port + 1);\nlib.change();\nconsole.log(lib.config.port + 1);",
      "const taken = lib.config;\nconst before = taken.port;\nlib.change();\nconsole.log(before === taken.port, taken.port);",
      "console.log(lib.config.tags.length);\nlib.change();\nconsole.log(lib.config.tags.length);",
      "console.log(lib.config.tags.join());\nlib.change();\nconsole.log(lib.config.tags[1]);",
      "console.log(Object.keys(lib.config).join());\nlib.change();\nconsole.log(Object.keys(lib.config).join());",
      "console.log(JSON.stringify(lib.config));\nlib.change();\nconsole.log(JSON.stringify(lib.config));",
    ],
  },
  "a function under another name": {
    says: "export declare function make(): number;\nexport declare function create(): number;",
    runs: [
      "export function make() {\nreturn 1;\n}\nexport function create() {\nreturn 2;\n}",
      "export function make() {\nreturn 1;\n}",
      "export function make() {\nreturn 1;\n}\nexport const create = 2;",
      "export function make() {\nreturn 1;\n}\nexport const Create = () => 2;",
    ],
    uses: [
      "typeof lib.create",
      "lib.create?.()",
      "lib.create()",
      "lib.create() + 1",
      `"create" in lib`,
      "Object.keys(lib).join()",
      `lib.make() + (typeof lib.create === "function" ? 1 : 0)`,
    ],
    onlyThroughTheWhole: true,
  },
  "a function with other parameters": {
    says: "export declare function add(a: number, b: number): number;",
    runs: [
      "export function add(a, b) {\nreturn a + b;\n}",
      "export function add(a, b, c) {\nreturn a + b + c;\n}",
      "export function add({ a, b }) {\nreturn a + b;\n}",
      "export function add(a) {\nreturn a;\n}",
      "export function add() {\nreturn arguments.length;\n}",
      "export function add(...all) {\nreturn all.length;\n}",
      "export function add(a, b = 10, c = 100) {\nreturn a + b + c;\n}",
      "export function add(b, a) {\nreturn a - b;\n}",
      "export const add = (a, b) => String(a) + b;",
      "export function add([a], b) {\nreturn a + b;\n}",
    ],
    uses: [
      "lib.add(1, 2)",
      "lib.add(1, 2) + 1",
      "lib.add(1.5, 2)",
      "lib.add.length",
      "[1, 2, 3].reduce(lib.add)",
      "lib.add(lib.add(1, 2), 3)",
      "typeof lib.add(1, 2)",
      "lib.add(1, 2).toFixed(1)",
      "let summed = 0;\nfor (let at = 0; at < 3; at++) summed += lib.add(at, 1);\nconsole.log(summed);",
    ],
  },
  "an optional parameter that is needed": {
    says: "export declare function pad(text: string, width?: number): string;",
    runs: [
      "export function pad(text, width = 3) {\nreturn text.padStart(width);\n}",
      "export function pad(text, width) {\nreturn text.padStart(width);\n}",
      "export function pad(text, width) {\nreturn text + width.toFixed(0);\n}",
      "export function pad(text, width) {\nreturn text.length + width;\n}",
      "export function pad(text, { width }) {\nreturn text.padStart(width);\n}",
    ],
    uses: [
      `lib.pad("a")`,
      `lib.pad("a", 3)`,
      `lib.pad("a").length`,
      `lib.pad("a") + "!"`,
      `lib.pad("a", undefined)`,
      `typeof lib.pad("a")`,
    ],
  },
  "a class where a function is exported": {
    says: "export declare class Maker {\n  value: number;\n  constructor(value: number);\n  twice(): number;\n}",
    runs: [
      "export class Maker {\nconstructor(value) {\nthis.value = value;\n}\ntwice() {\nreturn this.value * 2;\n}\n}",
      "export function Maker(value) {\nthis.value = value;\n}\nMaker.prototype.twice = function () {\nreturn this.value * 2;\n};",
      "export function Maker(value) {\nreturn { value, twice() {\nreturn value * 2;\n} };\n}",
      "export const Maker = value => ({ value, twice: () => value * 2 });",
      "export class Maker {\nconstructor(value) {\nthis.held = value;\n}\ntwice() {\nreturn this.held * 2;\n}\n}",
      "export class Maker {\n#value;\nconstructor(value) {\nthis.#value = value;\n}\nget value() {\nreturn this.#value;\n}\ntwice() {\nreturn this.#value * 2;\n}\n}",
      'export class Maker {\nvalue = "none";\ntwice = () => this.value + this.value;\n}',
      "export class Maker {\nconstructor(value) {\nreturn [value];\n}\n}",
      "export const Maker = { value: 1 };",
      "export const Maker = new Proxy(class {\nconstructor(value) {\nthis.value = value;\n}\ntwice() {\nreturn this.value * 2;\n}\n}, {});",
    ],
    uses: [
      "new lib.Maker(2).value",
      "new lib.Maker(2).value + 1",
      "new lib.Maker(2).twice()",
      "new lib.Maker(2).twice() + 1",
      "new lib.Maker(2) instanceof lib.Maker",
      "Object.keys(new lib.Maker(2)).join()",
      "JSON.stringify(new lib.Maker(2))",
      "typeof lib.Maker",
      "lib.Maker.name",
      "lib.Maker.length",
      "typeof lib.Maker.prototype",
      "const made = new lib.Maker(2);\nmade.value = 5;\nconsole.log(made.value, made.twice());",
      "const made = new lib.Maker(2);\nmade.value += 1;\nconsole.log(made.value);",
      "class Below extends lib.Maker {\nmore = 1;\n}\nconst below = new Below(2);\nconsole.log(below.value, below.more);",
      "class Below extends lib.Maker {\ntwice() {\nreturn super.twice() + 1;\n}\n}\nconsole.log(new Below(2).twice());",
      "class Below extends lib.Maker {\nconstructor() {\nsuper(3);\nthis.value++;\n}\n}\nconsole.log(new Below().value);",
      "const list = [new lib.Maker(1), new lib.Maker(2)];\nlet summed = 0;\nfor (const each of list) summed += each.value;\nconsole.log(summed);",
    ],
  },
  "a function where a class is exported": {
    says: "export declare function make(value: number): { value: number };",
    runs: [
      "export function make(value) {\nreturn { value };\n}",
      "export class make {\nconstructor(value) {\nthis.value = value;\n}\n}",
      "export async function make(value) {\nreturn { value };\n}",
      "export function* make(value) {\nyield { value };\n}",
      "export function make(value) {\nthis.value = value;\n}",
      "export function make(value) {\nreturn value;\n}",
      "export const make = { value: 1 };",
    ],
    uses: [
      "lib.make(2).value",
      "lib.make(2).value + 1",
      "typeof lib.make(2)",
      "Object.keys(lib.make(2)).join()",
      "JSON.stringify(lib.make(2))",
      "const { value } = lib.make(2);\nconsole.log(value);",
      "typeof lib.make",
    ],
  },
  "a test that says what a value is": {
    says: "export declare function isText(value: unknown): value is string;",
    runs: [
      `export function isText(value) {\nreturn typeof value === "string";\n}`,
      "export function isText() {\nreturn true;\n}",
      "export function isText() {\nreturn false;\n}",
      `export function isText(value) {\nreturn typeof value === "number";\n}`,
      "export function isText() {\nreturn 1;\n}",
      `export function isText() {\nreturn "";\n}`,
      "export function isText() {}",
      "export function isText(value) {\nreturn value;\n}",
    ],
    uses: [
      `const values: (number | string)[] = [7, "text"];\nfor (const value of values) {\nif (lib.isText(value)) console.log(value.length);\nelse console.log(value + 1);\n}`,
      `const values: (number | string)[] = [7, "text"];\nfor (const value of values) console.log(lib.isText(value) ? value.toUpperCase() : value.toFixed(1));`,
      `const values: (number | string)[] = [7, "text"];\nconsole.log(values.filter(lib.isText).map(each => each.length).join());`,
      `const values: unknown[] = [7];\nconst value = values[0];\nif (lib.isText(value)) console.log(value.length, value + "!");\nelse console.log("no text");`,
      `const values: (number | string)[] = ["text"];\nconst value = values[0];\nif (!lib.isText(value)) console.log(value * 2);\nelse console.log(value.length);`,
      `const values: (string | null)[] = [null];\nconst value = values[0];\nconsole.log(lib.isText(value) ? value.length : "null");`,
      `console.log(lib.isText(7));\nconsole.log(lib.isText("text") === true);`,
      `const values: ({ a: number } | string)[] = [{ a: 1 }];\nconst value = values[0];\nconsole.log(lib.isText(value) ? value.length : value.a);`,
    ],
  },
  "an assertion about a value": {
    says: "export declare function assertNumber(value: unknown): asserts value is number;",
    runs: [
      `export function assertNumber(value) {\nif (typeof value !== "number") throw new TypeError("no number");\n}`,
      "export function assertNumber() {}",
      "export function assertNumber() {\nreturn false;\n}",
      `export function assertNumber(value) {\nif (typeof value === "number") throw new RangeError("a number");\n}`,
    ],
    uses: [
      `const values: unknown[] = ["text"];\nconst value = values[0];\nlib.assertNumber(value);\nconsole.log(value + 1);`,
      `const values: unknown[] = ["text"];\nconst value = values[0];\nlib.assertNumber(value);\nconsole.log(value.toFixed(1));`,
      `const values: unknown[] = [7];\nconst value = values[0];\nlib.assertNumber(value);\nconsole.log(value * 2);`,
      `const values: (number | null)[] = [null];\nconst value = values[0];\nlib.assertNumber(value);\nconsole.log(value + 1, typeof value);`,
      `const values: (number | string)[] = ["7"];\nconst value = values[0];\nlib.assertNumber(value);\nconsole.log(value | 0, value === 7);`,
      `function doubled(value: unknown): number {\nlib.assertNumber(value);\nreturn value * 2;\n}\nconsole.log(doubled("4"), doubled(4));`,
    ],
    reaches: ["by name", "the namespace"],
  },
  "a function that never returns": {
    says: "export declare function fail(message: string): never;",
    runs: [
      "export function fail(message) {\nthrow new RangeError(message);\n}",
      "export function fail() {}",
      `export function fail() {\nreturn "came back";\n}`,
      "export function fail(message) {\nreturn message.length;\n}",
    ],
    uses: [
      `function picked(flag: boolean): number {\nif (flag) return 1;\nlib.fail("no");\n}\nconsole.log(picked(true), picked(false));`,
      `const values: (number | undefined)[] = [];\nconst value: number = values[0] ?? lib.fail("none");\nconsole.log(value);`,
      `function named(kind: "a" | "b"): string {\nswitch (kind) {\ncase "a":\nreturn "first";\ndefault:\nreturn lib.fail(kind);\n}\n}\nconsole.log(named("b"));`,
      `console.log("ahead");\nlib.fail("no");\nconsole.log("behind");`,
      `let held = 1;\nif (held > 0) {\nheld = 2;\nlib.fail("no");\n}\nconsole.log(held);`,
      `const values: (string | null)[] = [null];\nconst value = values[0];\nif (value === null) lib.fail("null");\nconsole.log(value === null, typeof value);`,
      `for (let at = 0; at < 3; at++) {\nif (at === 1) lib.fail("one");\nconsole.log(at);\n}`,
    ],
    reaches: ["by name", "the namespace"],
  },
  "a function that returns nothing": {
    says: "export declare function log(): void;",
    runs: [
      "export function log() {}",
      "export function log() {\nreturn 5;\n}",
      `export function log() {\nreturn "text";\n}`,
      "export async function log() {}",
      "export function log() {\nreturn null;\n}",
    ],
    uses: [
      "const result = lib.log();\nconsole.log(result);",
      "console.log(typeof lib.log());",
      "console.log([1, 2].map(() => lib.log()).join());",
      "const results: void[] = [lib.log()];\nconsole.log(results.length, results[0]);",
      "console.log(lib.log() === undefined);",
    ],
  },
  overloads: {
    says: "export declare function turned(value: string): number;\nexport declare function turned(value: number): string;",
    runs: [
      `export function turned(value) {\nreturn typeof value === "string" ? Number(value) : String(value);\n}`,
      "export function turned(value) {\nreturn value;\n}",
      "export function turned(value) {\nreturn String(value);\n}",
      "export function turned(value) {\nreturn Number(value);\n}",
      "export function turned() {}",
      "export function turned(value) {\nreturn [value];\n}",
    ],
    uses: [
      `lib.turned("1") + 1`,
      "lib.turned(1).length",
      `lib.turned("1").toFixed(1)`,
      "lib.turned(1).toUpperCase()",
      `typeof lib.turned("1")`,
      `lib.turned(lib.turned("1"))`,
      `lib.turned("1") * 2`,
      `lib.turned(1) + "!"`,
    ],
  },
  "a generic function": {
    says: "export declare function first<T>(list: T[]): T;",
    runs: [
      "export function first(list) {\nreturn list[0];\n}",
      "export function first(list) {\nreturn list.length;\n}",
      "export function first(list) {\nreturn list;\n}",
      "export function first() {}",
      "export function first(list) {\nreturn String(list[0]);\n}",
      "export function first(list) {\nreturn list[1];\n}",
      "export function first(list) {\nreturn { first: list[0] };\n}",
    ],
    uses: [
      "lib.first([1, 2, 3]) + 1",
      `lib.first(["a", "b"]).length`,
      "lib.first([{ a: 1 }]).a",
      "lib.first<number>([1]).toFixed(1)",
      "lib.first([[1], [2]]).length",
      "lib.first([1.5]) * 2",
      "typeof lib.first([true])",
      "lib.first([() => 1])()",
      "const held: number = lib.first([1, 2]);\nconsole.log(held + 1);",
      "let summed = 0;\nfor (let at = 0; at < 3; at++) summed += lib.first([at, 1]);\nconsole.log(summed);",
    ],
  },
  "a generic function that takes a function": {
    says: "export declare function mapAll<T, U>(list: T[], change: (value: T) => U): U[];",
    runs: [
      "export function mapAll(list, change) {\nconst result = [];\nfor (const value of list) result.push(change(value));\nreturn result;\n}",
      "export function mapAll(list, change) {\nreturn list.map(change);\n}",
      "export function mapAll(list, change) {\nreturn list.map((_, at) => change(at));\n}",
      "export function mapAll(list, change) {\nreturn list.map(value => change(String(value)));\n}",
      "export function mapAll(list, change) {\nreturn list.map(() => change());\n}",
      "export function mapAll(list, change) {\nreturn new Set(list.map(value => change(value)));\n}",
      "export function mapAll(list, change) {\nreturn change(list);\n}",
      "export function mapAll(list) {\nreturn list;\n}",
    ],
    uses: [
      "lib.mapAll([1, 2, 3], value => value * 2).join()",
      `lib.mapAll(["a", "bc"], value => value.length)[1] + 1`,
      "lib.mapAll([1, 2], value => value.toFixed(1)).length",
      "lib.mapAll([{ a: 1 }], value => value.a)[0]",
      "lib.mapAll([1, 2, 3], value => value + 1).length",
      "lib.mapAll([1, 2, 3], (value: number) => typeof value).join()",
      "let summed = 0;\nfor (const each of lib.mapAll([1, 2, 3], value => value * 2)) summed += each;\nconsole.log(summed);",
    ],
  },
  "an enum with other values": {
    says: "export declare enum Level {\n  Low = 1,\n  High = 2,\n}",
    runs: [
      `export const Level = { Low: 1, High: 2, 1: "Low", 2: "High" };`,
      `export const Level = { Low: 10, High: 20, 10: "Low", 20: "High" };`,
      `export const Level = { Low: "low", High: "high" };`,
      "export const Level = { Low: 1 };",
      "export const Level = {};",
      `export const Level = Object.freeze({ High: 1, Low: 2, 1: "High", 2: "Low" });`,
      "export const Level = { get Low() {\nreturn 3;\n}, High: 2 };",
    ],
    uses: [
      "lib.Level.Low",
      "lib.Level.High + 1",
      "lib.Level[lib.Level.High]",
      "lib.Level[1]",
      "lib.Level.Low === 1",
      "lib.Level.Low < lib.Level.High",
      "typeof lib.Level.Low",
      "Object.keys(lib.Level).join()",
      "[0, 10, 20][lib.Level.Low]",
      `const levels: lib.Level[] = [lib.Level.High];\nconst level = levels[0];\nswitch (level) {\ncase lib.Level.Low:\nconsole.log("low");\nbreak;\ncase lib.Level.High:\nconsole.log("high");\nbreak;\n}`,
      "const levels: lib.Level[] = [lib.Level.Low, lib.Level.High];\nconsole.log(levels.join());",
      `const names: Record<lib.Level, string> = { [lib.Level.Low]: "l", [lib.Level.High]: "h" };\nconsole.log(Object.keys(names).join());`,
    ],
    reaches: ["by name", "the namespace"],
  },
  "a const enum with other values": {
    says: "export declare const enum Mode {\n  Off = 0,\n  On = 1,\n}",
    runs: [
      "export const Mode = { Off: 0, On: 1 };",
      "export const Mode = { Off: 5, On: 6 };",
      `export const Mode = { Off: "off", On: "on" };`,
      "export const Mode = { Off: 0 };",
    ],
    uses: [
      "lib.Mode.On",
      "lib.Mode.On + 1",
      "lib.Mode.Off === 0",
      "typeof lib.Mode.On",
      "[10, 20][lib.Mode.On]",
      `const mode: lib.Mode = lib.Mode.On;\nconsole.log(mode === lib.Mode.On, mode);`,
    ],
    reaches: ["by name", "the namespace"],
  },
  "a promise where a value comes": {
    says: "export declare function load(): Promise<number>;",
    runs: [
      "export async function load() {\nreturn 5;\n}",
      "export function load() {\nreturn 5;\n}",
      "export function load() {\nreturn { then(done) {\ndone(6);\n} };\n}",
      `export async function load() {\nreturn "5";\n}`,
      "export function load() {}",
      "export function load() {\nreturn Promise.resolve(Promise.resolve(7));\n}",
      "export function load() {\nreturn { then: 5 };\n}",
    ],
    uses: [
      "await lib.load()",
      "(await lib.load()) + 1",
      "typeof lib.load().then",
      "lib.load() instanceof Promise",
      "(await Promise.all([lib.load()]))[0]",
      "lib.load().then(value => console.log(value + 1));",
      "const value: number = await lib.load();\nconsole.log(value * 2);",
    ],
  },
  "a value where a promise comes": {
    says: "export declare function load(): number;",
    runs: [
      "export function load() {\nreturn 5;\n}",
      "export async function load() {\nreturn 5;\n}",
      "export function* load() {\nyield 5;\n}",
      "export function load() {\nreturn Promise.resolve(5);\n}",
    ],
    uses: [
      "typeof lib.load()",
      "String(lib.load() + 1)",
      "lib.load() > 1",
      "await lib.load()",
      "lib.load() * 2",
      "Number.isInteger(lib.load())",
    ],
  },
  "a list where something else can be walked": {
    says: "export declare function items(): number[];",
    runs: [
      "export function items() {\nreturn [1, 2, 3];\n}",
      "export function* items() {\nyield 1;\nyield 2;\nyield 3;\n}",
      "export function items() {\nreturn new Set([1, 2, 3]);\n}",
      "export function items() {\nreturn new Uint8Array([1, 2, 3]);\n}",
      `export function items() {\nreturn "123";\n}`,
      "export function items() {\nreturn { length: 3, 0: 1, 1: 2, 2: 3 };\n}",
      "export function items() {\nreturn arguments;\n}",
      "export function items() {\nreturn [1, , 3];\n}",
      "export function items() {\nreturn new Map([[1, 2]]).keys();\n}",
    ],
    uses: [
      "lib.items().length",
      "lib.items()[0]",
      "lib.items()[1] + 1",
      "[...lib.items()].join()",
      "lib.items().map(each => each + 1).join()",
      "lib.items().join()",
      "Array.isArray(lib.items())",
      "Math.max(...lib.items())",
      "const [one, two] = lib.items();\nconsole.log(one, two);",
      "let summed = 0;\nfor (const each of lib.items()) summed += each;\nconsole.log(summed);",
      "const list = lib.items();\nlet summed = 0;\nfor (let at = 0; at < list.length; at++) summed += list[at];\nconsole.log(summed);",
      "const list = lib.items();\nlist.push(4);\nconsole.log(list.length);",
    ],
  },
  "the fields of a class": {
    says: "export declare class Counter {\n  count: number;\n  step: number;\n  increment(): number;\n}",
    runs: [
      "export class Counter {\ncount = 0;\nstep = 1;\nincrement() {\nreturn (this.count += this.step);\n}\n}",
      `export class Counter {\ncount = "0";\nstep = 1;\nincrement() {\nreturn (this.count += this.step);\n}\n}`,
      "export class Counter {\n#count = 0;\nstep = 1;\nget count() {\nreturn this.#count;\n}\nset count(value) {\nthis.#count = value * 2;\n}\nincrement() {\nreturn (this.#count += this.step);\n}\n}",
      "export class Counter {\nstep = 1;\ncount = 0;\nincrement = () => (this.count += this.step);\n}",
      "export class Counter {\nstep = 1;\nincrement() {\nreturn (this.count = (this.count ?? 0) + this.step);\n}\n}",
      "export class Counter {\ncount = 0;\nstep = 0.5;\nincrement() {\nreturn (this.count += this.step);\n}\n}",
      "export class Counter {\ncount = 0;\nstep = 1;\ninc() {\nreturn (this.count += this.step);\n}\n}",
      "export class Counter {\ncount = 0;\nstep = 1;\nmore = [];\nincrement() {\nthis.more.push(this.count);\nreturn (this.count += this.step);\n}\n}",
      "export class Counter {\ncount = 2147483647;\nstep = 1;\nincrement() {\nreturn (this.count += this.step);\n}\n}",
    ],
    uses: [
      "const counter = new lib.Counter();\ncounter.increment();\nconsole.log(counter.count + 1);",
      "const counter = new lib.Counter();\nconsole.log(counter.count, counter.step);",
      "const counter = new lib.Counter();\nconsole.log(Object.keys(counter).join());",
      "const counter = new lib.Counter();\ncounter.count = 5;\nconsole.log(counter.increment(), counter.count);",
      "const counter = new lib.Counter();\ncounter.step = 2;\nconsole.log(counter.increment() + counter.increment());",
      "const counter = new lib.Counter();\nfor (let at = 0; at < 10000; at++) counter.increment();\nconsole.log(typeof counter.count, String(counter.count).length);",
      "const counter = new lib.Counter();\nlet summed = 0;\nfor (let at = 0; at < 10000; at++) {\ncounter.count += 1;\nsummed += counter.count | 0;\n}\nconsole.log(summed);",
      "const counter = new lib.Counter();\nconst { count, step } = counter;\nconsole.log(count + step);",
      "const counter = new lib.Counter();\nconsole.log(JSON.stringify(counter));",
      "const increment = new lib.Counter().increment;\nconsole.log(typeof increment);",
      "class Below extends lib.Counter {\ncount = 10;\n}\nconst below = new Below();\nconsole.log(below.increment(), below.count);",
    ],
  },
  "a tuple": {
    says: "export declare function pair(): [number, string];",
    runs: [
      `export function pair() {\nreturn [1, "two"];\n}`,
      `export function pair() {\nreturn ["two", 1];\n}`,
      "export function pair() {\nreturn [1];\n}",
      `export function pair() {\nreturn { 0: 1, 1: "two" };\n}`,
      `export function pair() {\nreturn [1, "two", 3];\n}`,
      "export function pair() {\nreturn [];\n}",
    ],
    uses: [
      "lib.pair()[0] + 1",
      "lib.pair()[1].length",
      "lib.pair().length",
      "const [count, label] = lib.pair();\nconsole.log(count + 1, label.length);",
      "const [count] = lib.pair();\nconsole.log(count * 2);",
      'const [, label] = lib.pair();\nconsole.log(label + "!");',
    ],
  },
  "the receiver of a function": {
    says: "export declare function self(this: { n: number }): number;",
    runs: [
      "export function self() {\nreturn this.n;\n}",
      "export const self = () => 5;",
      "export function self() {\nreturn typeof this;\n}",
      "export function self() {\nreturn this;\n}",
      "export const self = function () {\nreturn this.n;\n}.bind({ n: 9 });",
    ],
    uses: [
      "lib.self.call({ n: 1 })",
      "lib.self.call({ n: 1 }) + 1",
      "const holder = { n: 2, self: lib.self };\nconsole.log(holder.self());",
      "lib.self.apply({ n: 3 })",
      "lib.self.bind({ n: 4 })()",
    ],
  },
  "private members": {
    says: "export declare class Vault {\n  private secret;\n  open(): number;\n}",
    runs: [
      "export class Vault {\nsecret = 1;\nopen() {\nreturn this.secret;\n}\n}",
      "export class Vault {\n#secret = 1;\nopen() {\nreturn this.#secret;\n}\n}",
      "export class Vault {\nopen() {\nreturn 1;\n}\n}",
      `export class Vault {\nsecret = "one";\nother = 2;\nopen() {\nreturn this.secret;\n}\n}`,
    ],
    uses: [
      "Object.keys(new lib.Vault()).join()",
      "JSON.stringify(new lib.Vault())",
      "new lib.Vault().open()",
      "new lib.Vault().open() + 1",
      `"secret" in new lib.Vault()`,
      "class Below extends lib.Vault {\nmine = 3;\n}\nconsole.log(Object.keys(new Below()).join());",
    ],
  },
  "a getter behind a read-only member": {
    says: "export declare const clock: { readonly now: number };",
    runs: [
      "export const clock = { now: 1 };",
      "let turns = 0;\nexport const clock = { get now() {\nreturn ++turns;\n} };",
      `let turns = 0;\nexport const clock = { get now() {\nreturn turns++ ? "late" : 0;\n} };`,
      "export const clock = new Proxy({}, { get: () => 7 });",
      "export const clock = Object.create({ now: 2 });",
    ],
    uses: [
      "lib.clock.now + lib.clock.now",
      "lib.clock.now === lib.clock.now",
      "const { now } = lib.clock;\nconsole.log(now, lib.clock.now);",
      "let summed = 0;\nfor (let at = 0; at < 3; at++) summed += lib.clock.now;\nconsole.log(summed);",
      "Object.keys(lib.clock).join()",
      "JSON.stringify(lib.clock)",
    ],
  },
  "one value for the whole file": {
    says: "declare function run(): number;\nexport = run;",
    isCommon: true,
    runs: [
      "module.exports = function run() {\nreturn 1;\n};",
      "module.exports = { default: function run() {\nreturn 1;\n} };",
      "exports.run = function run() {\nreturn 1;\n};",
      `Object.defineProperty(exports, "__esModule", { value: true });\nexports.default = function run() {\nreturn 1;\n};`,
      "module.exports = 5;",
      "module.exports = class run {};",
      'module.exports = () => "text";',
    ],
    uses: ["lib()", "lib() + 1", "typeof lib", "lib.name", "lib.length", "typeof lib()"],
    reaches: ["the default", "import = require"],
  },
  "a default export": {
    says: "declare const value: number;\nexport default value;",
    isCommon: true,
    runs: [
      `Object.defineProperty(exports, "__esModule", { value: true });\nexports.default = 5;`,
      "module.exports = 5;",
      "exports.default = 5;",
      "module.exports = { default: 5 };",
      `module.exports = { __esModule: true, default: "5" };`,
      "module.exports = { value: 5 };",
    ],
    uses: ["lib", "lib + 1", "typeof lib", "lib * 2", "JSON.stringify(lib)", "lib === 5"],
    reaches: ["the default"],
  },
  "a member that only an augmentation declares": {
    says: "export declare const present: number;",
    runs: [
      "export const present = 1;\nexport const added = 2;",
      "export const present = 1;",
      `export const present = 1;\nexport const added = "two";`,
      "export const present = 1;\nexport const added = [2];",
    ],
    uses: [
      "lib.added",
      "lib.added + 1",
      "typeof lib.added",
      "lib.present + lib.added",
      `"added" in lib`,
      "lib.added.toFixed(1)",
    ],
    onlyThroughTheWhole: true,
    declares: "declare module WHERE {\n  export const added: number;\n}",
  },
  "a method that a global interface is given": {
    says: "export declare const installed: boolean;",
    runs: [
      `String.prototype.shout = function () {\nreturn this.toUpperCase() + "!";\n};\nexport const installed = true;`,
      "export const installed = false;",
      "String.prototype.shout = function () {\nreturn this.length;\n};\nexport const installed = true;",
      `Object.defineProperty(String.prototype, "shout", { get() {\nreturn () => "got";\n}, configurable: true });\nexport const installed = true;`,
      `String.prototype.shout = () => "arrow";\nexport const installed = true;`,
    ],
    uses: [
      `console.log(lib.installed);\nconsole.log("a".shout());`,
      `console.log(lib.installed, "a".shout().length);`,
      `console.log(lib.installed, typeof "a".shout);`,
      `console.log(lib.installed, "a".shout() + "?");`,
      `const text: string = ["b"][0];\nconsole.log(lib.installed, text.shout());`,
    ],
    declares: "declare global {\n  interface String {\n    shout(): string;\n  }\n}",
  },
};

export const said = Object.keys(lies);

/** What makes a declaration file invalid and leaves what it exports as it is. */
const invalidDeclarations = [
  "export declare const unrelated: Missing;",
  "export declare function unrelated(value: Missing.Inner): NotThere<number>;",
  "export interface Twice {\n  member: number;\n}\nexport interface Twice {\n  member: string;\n}",
  "export type Round = Around;\nexport type Around = Round;",
  "export declare class Under extends Under {}",
  "export declare const assigned: string = 5;",
  "export type Argued = Array<number, string>;",
  "export type Keyed = { [key: boolean]: number };",
  'export type Indexed = { a: number }["b"];',
  "export declare const typed: typeof notDeclared;",
  "export type Constrained<T extends string> = T;\nexport type Broken = Constrained<number>;",
];

const common = (text: string) =>
  text
    .replace(/^export (async function\*?|function\*?) (\w+)/gm, "exports.$2 = $1 $2")
    .replace(/^export class (\w+)/gm, "exports.$1 = class $1")
    .replace(/^export const (\w+) =/gm, "exports.$1 =");

export function generate(
  random: Random,
  name: string = random.pick(said),
): { file: string; text: string; files: Record<string, string> } {
  // The relations first.
  const lie = lies[name];
  const runs = random.chance(0.12) ? lie.runs[0] : random.pick(lie.runs.slice(1));
  const use = random.pick(lie.uses);
  const place = random.weighted([
    [5, "beside"],
    [1, "types"],
    [1, "typings"],
    [1, "exports"],
    [1, "beside the main file"],
    [1, "index.d.ts"],
    [1, "@types"],
    [lie.declares?.includes("WHERE") || lie.isCommon ? 0 : 2, "declare module"],
  ] as const);
  const isPackage = place !== "beside";
  // A file whose exports change, or that declares functions and classes it uses itself, stays an ES module.
  const isCommon =
    lie.isCommon ||
    (!/^export let |^let |^String\.|^Object\.define|\bMaker\.prototype|\bconfig\./m.test(runs) && random.chance(0.25));
  const reach = random.pick(
    (lie.reaches ?? (["by name", "the namespace", "import()"] as const)).filter(
      how => !(lie.onlyThroughTheWhole && how === "by name") && !(lie.declares && how === "import()"),
    ),
  );
  const isBetween = !lie.isCommon && !lie.declares && reach !== "import()" && random.chance(0.25);
  const isInvalid = place !== "declare module" && random.chance(0.25);
  const isUsedInAnotherFile = random.chance(0.3);
  const isExpression = !use.includes("console.log");
  const loops = isExpression && !/\bawait\b/.test(use) && random.chance(0.3);
  const guard = random.chance(0.6);
  const isInAFunction = !/\bawait\b/.test(use) && random.chance(0.4);
  const isStrict = random.chance(0.85);
  const writesEnds = random.chance(0.5);

  const files: Record<string, string> = {};
  const packageName = random.pick(["lib", "@scope/lib"]);
  const end = isCommon ? (isPackage && random.chance(0.5) ? "js" : "cjs") : random.pick(["js", "js", "mjs"]);
  const folder = isPackage ? `node_modules/${packageName}/` : "";
  const declarationEnd = { js: "d.ts", mjs: "d.mts", cjs: "d.cts" }[end]!;
  const where = isPackage ? packageName : `./lib.${end}`;
  files[`${folder}lib.${end}`] = (isCommon && !lie.isCommon ? common(runs) : runs) + "\n";
  const more = isInvalid ? random.sample(invalidDeclarations, random.between(1, 2)) : [];
  const says = (random.chance(0.5) ? [...more, lie.says] : [lie.says, ...more]).join("\n") + "\n";
  if (isPackage) {
    const about: Record<string, unknown> = { name: packageName, version: "1.0.0" };
    if (end === "js") about.type = isCommon ? "commonjs" : "module";
    if (place === "exports") about.exports = { ".": { types: `./lib.${declarationEnd}`, default: `./lib.${end}` } };
    else about.main = `./lib.${end}`;
    if (place === "types" || place === "typings") {
      about[place] = "./typings/own.d.ts";
      files[`${folder}typings/own.d.ts`] = says;
    } else if (place === "exports" || place === "beside the main file") files[`${folder}lib.${declarationEnd}`] = says;
    else if (place === "index.d.ts") files[`${folder}index.d.ts`] = says;
    else if (place === "@types") {
      const typings = packageName.replace(/^@(\w+)\//, "$1__");
      files[`node_modules/@types/${typings}/package.json`] =
        JSON.stringify({ name: `@types/${typings}`, version: "1.0.0", types: "index.d.ts" }, null, 2) + "\n";
      files[`node_modules/@types/${typings}/index.d.ts`] = says;
    } else
      files["ambient.d.ts"] = `declare module ${JSON.stringify(packageName)} {\n${lie.says
        .replace(/^export declare /gm, "export ")
        .replace(/^declare /gm, "")
        .replace(/^/gm, "  ")}\n}\n`;
    files[`${folder}package.json`] = JSON.stringify(about, null, 2) + "\n";
  } else files[`lib.${declarationEnd}`] = says;

  let from = where;
  if (isBetween) {
    files["between.ts"] = `export * from ${JSON.stringify(where)};\n`;
    from = writesEnds ? "./between.ts" : "./between";
  }

  // The file that uses it.
  const names = [...new Set(Array.from(use.matchAll(/\blib\.(\w+)/g), match => match[1]))];
  const head: string[] = [];
  let text = use;
  if (reach === "by name") {
    head.push(`import { ${names.join(", ")} } from ${JSON.stringify(from)};`);
    text = use.replace(/\blib\./g, "");
  } else if (reach === "the namespace") head.push(`import * as lib from ${JSON.stringify(from)};`);
  else if (reach === "the default") head.push(`import lib from ${JSON.stringify(from)};`);
  else if (reach === "import = require") head.push(`import lib = require(${JSON.stringify(from)});`);
  else head.push(`const lib = await import(${JSON.stringify(from)});`);
  if (lie.declares) head.push(lie.declares.replace("WHERE", JSON.stringify(where)));
  let lines = isExpression
    ? loops
      ? ["let result;", "for (let turn = 0; turn < 10000; turn++) result = " + text + ";", "console.log(result);"]
      : [text.endsWith(";") ? text : `console.log(${text});`]
    : text.split("\n");
  if (guard)
    lines = [
      "try {",
      ...lines,
      "} catch (error) {",
      `console.log("THROWS", error instanceof TypeError ? "TypeError" : error instanceof RangeError ? "RangeError" : typeof error);`,
      "}",
    ];
  const isModule = head.some(line => line.startsWith("import "));
  const options = {
    target: "esnext",
    module: "preserve",
    moduleResolution: "bundler",
    noEmit: true,
    strict: isStrict,
    types: [],
    ...(isInvalid || random.chance(0.2) ? { skipLibCheck: true } : {}),
    ...(writesEnds && { allowImportingTsExtensions: true }),
  };
  files["tsconfig.json"] = JSON.stringify({ compilerOptions: options }, null, 2) + "\n";
  if (isUsedInAnotherFile) {
    const usesAwait = lines.some(line => /\bawait\b/.test(line));
    files["user.ts"] =
      [...head, `export ${usesAwait ? "async " : ""}function run() {`, ...lines, "}"].join("\n") + "\n";
    const isMainTyped = random.chance(0.6);
    return {
      file: isMainTyped ? "main.ts" : "main.js",
      text: `import { run } from ${JSON.stringify(isMainTyped && !writesEnds ? "./user" : "./user.ts")};\n${usesAwait ? "await " : ""}run();\n`,
      files,
    };
  }
  if (isInAFunction) lines = ["function run() {", ...lines, "}", "run();"];
  return { file: "main.ts", text: [...head, ...lines, ...(isModule ? [] : ["export {};"])].join("\n") + "\n", files };
}
