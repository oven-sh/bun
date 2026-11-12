// What a thing costs the first time, where there is no second: a file makes `count` DIFFERENT classes, layouts, sites .. once each, at its top.
// Every other measurement here runs a thing a thousand times and divides, so what the run time learns the first time is divided away. The launch of a large application is made of first times:
// of the layouts that came alive in one, two in three made a single object, and nearly every site that left its stub left it once.
// An item's price = (the file of 2 n items - the file of n items) / n, less the same for the row that only pushes a number where the item pushes what it made. What loads the file and starts the
// process cancels out.
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";

export type Row = {
  name: string;
  /** Of the file with the items. A `.js` file is a CommonJS file. */
  extension: "ts" | "js";
  head?: string;
  item(index: number): string;
  tail?: string;
};

export const yardstick: Row = { name: "a number is pushed", extension: "ts", item: index => `sink.push(${index});` };
export const pushes = (row: Row) => row.item(0).includes("sink.push(");

const methods = (index: number) => `first${index}() { return ${index}; } second${index}() { return "${index}"; }`;
const unknownObject = (text: string) => `JSON.parse(process.env.NO_SUCH_NAME ?? '${text}')`;

export const rows: Row[] = [
  {
    name: "a class that is exported and that nobody touches",
    extension: "ts",
    item: index => `export class C${index} { ${methods(index)} }`,
  },
  {
    name: "a class whose object is taken",
    extension: "ts",
    item: index => `class C${index} { ${methods(index)} }\nsink.push(C${index});`,
  },
  {
    name: "a class and its first instance",
    extension: "ts",
    item: index => `class C${index} { x${index} = ${index}; y = 2; ${methods(index)} }\nsink.push(new C${index}());`,
  },
  {
    name: "a class below a class and its first instance",
    extension: "ts",
    head: `class Base { base() { return 0; } }\nsink.push(new Base());`,
    item: index =>
      `class D${index} extends Base { z${index} = ${index}; ${methods(index)} }\nsink.push(new D${index}());`,
  },
  {
    name: "a name stored on a class below a class",
    extension: "ts",
    head: `class Base { base() { return 0; } }\nsink.push(Base);`,
    item: index =>
      `class D${index} extends Base { first${index}() { return ${index}; } }\n(D${index} as unknown as { extra: number }).extra = ${index};\nsink.push(D${index});`,
  },
  {
    name: "a constructor function with two methods and its first instance",
    extension: "js",
    item: index =>
      `function F${index}() { this.x${index} = ${index}; this.y = 2; }\nF${index}.prototype.first${index} = function () { return ${index}; };\nF${index}.prototype.second${index} = function () { return "${index}"; };\nsink.push(new F${index}());`,
  },
  {
    name: "the first object of a layout",
    extension: "ts",
    item: index => `sink.push({ a${index}: ${index}, b${index}: "x", c${index}: true });`,
  },
  {
    name: "the first object of a site whose layout other sites share",
    extension: "ts",
    item: index => `sink.push({ a: ${index}, b: "x", c: true });`,
  },
  {
    name: "a field that a store adds to the one object of a layout",
    extension: "ts",
    item: index =>
      `const o${index}: { a${index}: number; b${index}?: number } = { a${index}: ${index} };\nsink.push(o${index});\no${index}.b${index} = 2;`,
  },
  {
    name: "a name stored on the exports",
    extension: "js",
    item: index => `exports.n${index} = ${index};`,
  },
  {
    name: "a value defined on the exports",
    extension: "js",
    item: index => `Object.defineProperty(exports, "n${index}", { value: ${index} });`,
  },
  {
    name: "a getter defined on the exports",
    extension: "js",
    item: index =>
      `Object.defineProperty(exports, "n${index}", { enumerable: true, get: function () { return ${index}; } });`,
  },
  {
    name: "a name stored on an object that the build knows nothing of",
    extension: "ts",
    head: `const unknown = ${unknownObject("{}")};\nsink.push(unknown);`,
    item: index => `unknown.n${index} = ${index};`,
  },
  {
    name: "a key of the run stored on an object that the build knows nothing of",
    extension: "ts",
    head: `const unknown = ${unknownObject("{}")};\nconst prefix: string = process.env.NO_SUCH_NAME ?? "k";\nsink.push(unknown);`,
    item: index => `unknown[prefix + ${index}] = ${index};`,
  },
  {
    name: "a store in a function that is called once and that others may call",
    extension: "ts",
    head: `const unknown = ${unknownObject("[" + "{},".repeat(7) + "{}]")};`,
    item: index =>
      `export function store${index}(object: Record<string, number>) { object.n${index} = ${index}; }\nstore${index}(unknown[${index % 8}]);`,
  },
  {
    name: "a name that its layout does not have, stored on the one object of a layout by a function that many call",
    extension: "ts",
    head: `export function put(object: object, value: number) { (object as { extra?: number }).extra = value; }`,
    item: index => `const o${index} = { a${index}: ${index} };\nsink.push(o${index});\nput(o${index}, ${index});`,
  },
  {
    name: "two fields that stores add to the one object of a layout, the first of them only in some runs",
    extension: "ts",
    head: `const flag = !process.env.NO_SUCH_NAME;`,
    item: index =>
      `const o${index}: { a${index}: number; b${index}?: number; c${index}?: number } = { a${index}: ${index} };\nsink.push(o${index});\nif (flag) o${index}.b${index} = 2;\no${index}.c${index} = 3;`,
  },
  {
    name: "a property of one large literal",
    extension: "ts",
    head: `sink.push({`,
    item: index => `  k${index}: ${index},`,
    tail: `});`,
  },
  {
    name: "a literal with a key of the run",
    extension: "ts",
    head: `const prefix: string = process.env.NO_SUCH_NAME ?? "k";`,
    item: index => `sink.push({ [prefix + ${index}]: ${index} });`,
  },
  {
    // What stands behind an accessor is listed among the keys by a stub. The image has the order of the text, so the stub finds each step there.
    name: "a literal with two getters and six properties behind them, handed to a function that nobody knows",
    extension: "ts",
    head: `const hand: (definition: object) => object = (globalThis as any)[process.env.NO_SUCH_NAME ?? "Object"];`,
    item: index =>
      `sink.push(hand({ name${index}: "n${index}", describe() { return "${index}"; }, get input() { return ${index}; }, get output() { return "${index}"; }, label() { return ""; }, deferred: true, enabled() { return true; }, safe() { return true; }, path: "p", render() { return null; } }));`,
  },
  {
    name: "two getters defined on an empty object by a function that goes through the names of a literal",
    extension: "js",
    head: `function define(target, all) { for (const name in all) Object.defineProperty(target, name, { get: all[name], enumerable: true }); }`,
    item: index =>
      `const n${index} = {};\ndefine(n${index}, { a${index}: () => ${index}, b${index}: () => "${index}" });\nsink.push(n${index});`,
  },
  {
    name: "a value defined on an object that the build knows nothing of",
    extension: "js",
    head: `const unknown = ${unknownObject("{}")};\nsink.push(unknown);`,
    item: index => `Object.defineProperty(unknown, "n${index}", { value: ${index} });`,
  },
  {
    name: "a read by name of an object that the build knows nothing of",
    extension: "ts",
    head: `const unknown = ${unknownObject('{"p0":0,"p1":1,"p2":2,"p3":3,"p4":4,"p5":5,"p6":6,"p7":7}')};`,
    item: index => `sink.push(unknown.p${index % 8});`,
  },
  {
    name: "a literal spread into a literal with a name of its own",
    extension: "ts",
    head: `const base = { a: 1, b: "x", c: true };`,
    item: index => `sink.push({ ...base, d${index}: ${index} });`,
  },
  {
    name: "an object that the build knows nothing of spread into a literal with a name of its own",
    extension: "ts",
    head: `const unknown = ${unknownObject('{"a":1,"b":"x","c":true}')};`,
    item: index => `sink.push({ ...unknown, d${index}: ${index} });`,
  },
  {
    name: "a literal assigned to an empty object",
    extension: "ts",
    item: index => `sink.push(Object.assign({}, { a${index}: ${index}, b${index}: "x", c${index}: true }));`,
  },
  {
    name: "the properties of a literal defined on an empty object by their descriptors",
    extension: "ts",
    item: index =>
      `sink.push(Object.defineProperties({}, Object.getOwnPropertyDescriptors({ a${index}: ${index}, b${index}: "x", c${index}: true })));`,
  },
  {
    // Every item has a text of its own under one name, so the field's type lists as many strings as there are items.
    name: "a literal with a text of its own defined on a literal of one function by its descriptors",
    extension: "ts",
    head: `function finish<T extends { name: string }>(definition: T) {\n  return Object.defineProperties({ enabled: true, label: () => definition.name }, Object.getOwnPropertyDescriptors(definition));\n}`,
    item: index => `sink.push(finish({ name: "n${index}", kind: "k${index}", order: ${index} }));`,
  },
  {
    // The type of the result names every property, so the target has a slot for each: a getter cannot stay in one.
    name: "a literal with two getters defined on a literal of one function by its descriptors",
    extension: "ts",
    head: `const defaults = { enabled: () => true, hidden: () => false, order: 0 };\ntype Definition = { name: string; title?: string; limit?: number; readonly input?: number; readonly output?: string; run?(): number; stop?(): number; show?(): string; tail0?: number; tail1?: number };\ntype Finished<T> = T & typeof defaults & { label(): string };\nfunction finish<T extends Definition>(definition: T): Finished<T> {\n  return Object.defineProperties({ ...defaults, label: () => definition.name }, Object.getOwnPropertyDescriptors(definition)) as unknown as Finished<T>;\n}`,
    item: index =>
      `sink.push(finish({ name: "n${index}", title: "t", get input() { return ${index}; }, limit: ${index}, get output() { return "o"; }, run() { return ${index}; }, stop() { return 0; }, show() { return ""; }, tail${index & 1}: 1 }));`,
    tail: `sink.push(Object.keys(sink[0] as object));`,
  },
  {
    name: "the keys of the one object of a layout",
    extension: "ts",
    item: index => `sink.push(Object.keys({ a${index}: ${index}, b${index}: "x", c${index}: true }));`,
  },
  {
    name: "the entries of the one object of a layout",
    extension: "ts",
    item: index => `sink.push(Object.entries({ a${index}: ${index}, b${index}: "x", c${index}: true }));`,
  },
  {
    name: "a function declaration taken as a value",
    extension: "ts",
    item: index => `function f${index}() { return ${index}; }\nsink.push(f${index});`,
  },
  {
    name: "a function expression",
    extension: "ts",
    item: index => `sink.push(function () { return ${index}; });`,
  },
  { name: "a pattern", extension: "ts", item: index => `sink.push(/a${index}b+/);` },
  {
    name: "a Set of three strings",
    extension: "ts",
    item: index => `sink.push(new Set(["a${index}", "b${index}", "c${index}"]));`,
  },
  {
    name: "a pattern whose text the run makes",
    extension: "ts",
    head: `const suffix: string = process.env.NO_SUCH_NAME ?? "b+";`,
    item: index => `sink.push(new RegExp("a${index}" + suffix));`,
  },
  {
    name: "a Set of a list of three strings",
    extension: "ts",
    item: index => `const l${index} = ["a${index}", "b${index}", "c${index}"];\nsink.push(l${index});\nsink.push(new Set(l${index}));`,
  },
  {
    name: "a Set of a list of six texts that the run puts together",
    extension: "ts",
    head: `const words: string[] = (process.env.NO_SUCH_NAME ?? "alpha beta gamma delta epsilon zeta").split(" ");`,
    item: index => `sink.push(new Set(words.map(word => word + ${index})));`,
  },
  { name: "a short string", extension: "ts", item: index => `sink.push("text number ${index}");` },
  {
    name: "a getter of the engine that refuses its receiver, read through super thirty calls deep and caught",
    extension: "ts",
    head: `class Pattern extends RegExp { get source(): string { try { return super.source; } catch (error) { return String(error).slice(0, 9); } } }\nconst bare = Object.create(Pattern.prototype) as Pattern;\nfunction deep(depth: number, work: () => void): void { if (depth > 0) { deep(depth - 1, work); sink.length; } else work(); }`,
    item: index => `deep(30, () => { sink.push(bare.source + ${index}); });`,
  },
  {
    name: "a literal of constants, three deep",
    extension: "ts",
    item: index => `sink.push({ a: [1, 2, { b: "x${index}" }] });`,
  },
];

/**
 * `main.js` and the file with the items, into a new folder. The entry sends itself a signal in front of the `require` of that file and behind it, for ./count-steps.ts and ./step-profile.ts:
 * with `marks: false` it does not, and runs by itself. Marks among the items would not do: the compiler moves a class past a call that cannot see it.
 */
export function writeProgram(folder: string, row: Row, count: number, { marks = true } = {}) {
  mkdirSync(folder, { recursive: true });
  const isModule = row.extension === "ts";
  const items = Array.from({ length: count }, (_, index) => row.item(index)).join("\n");
  writeFileSync(
    join(folder, `items.${row.extension}`),
    `${isModule ? "export const sink: unknown[] = [];" : "const sink = (exports.sink = []);"}\n${row.head ?? ""}\n${items}\n${row.tail ?? ""}\n`,
  );
  const mark = marks ? `process.kill(process.pid, "SIGUSR2");\n` : "";
  writeFileSync(
    join(folder, "main.js"),
    `${mark}const all = require("./items.${row.extension}");\n${mark}console.log(all.sink.length, typeof all.sink[Number(process.env.NO_SUCH_NAME ?? 0)], typeof all[process.env.NO_SUCH_NAME ?? "sink"]);\n`,
  );
  return join(folder, "main.js");
}

if (import.meta.main) {
  const [bun, folder, pattern, count = "100"] = process.argv.slice(2);
  const row = [yardstick, ...rows].find(row => new RegExp(pattern).test(row.name));
  if (!row) throw new Error(`no row is named like ${pattern}`);
  const entry = writeProgram(folder, row, Number(count));
  const executable = join(folder, "main");
  const { exitCode, stderr } = Bun.spawnSync({ cmd: [bun, "build", "--compile", "--aot", entry, "--outfile", executable], stdout: "ignore", stderr: "pipe" });
  if (exitCode !== 0) throw new Error(stderr.toString());
  console.log(`${row.name}, ${count} items:\n${bun} ${join(import.meta.dir, "step-profile.ts")} 20 ${executable}`);
}
