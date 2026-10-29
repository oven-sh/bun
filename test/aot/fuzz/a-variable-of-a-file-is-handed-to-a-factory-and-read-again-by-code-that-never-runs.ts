// A table, no seeds: a file keeps something in a variable at its top level, hands it to a function of another file that returns closures over its arguments, and exports what comes back. Code of the same file that never runs reads the variable too.
// The entry point imports what was exported and calls it: what the closures kept is what the variable held.
//
//   what the variable holds x who else reads it x how the factory keeps its arguments x how the parts lie in files x whether the entry point uses the factory too
//
// One case to a program.
type Named = { name: string; text: string };

/** Each declares `held`. What `isWritable` can be stored to. */
const holders: readonly (Named & { isWritable?: true })[] = [
  { name: "a const object", text: "const held = { low: {}, high: {} };" },
  { name: "a let object", text: "let held = { low: {}, high: {} };", isWritable: true },
  { name: "a var object", text: "var held = { low: {}, high: {} };", isWritable: true },
  { name: "a list", text: "const held = [{ low: 1 }, { high: 2 }];" },
  { name: "a list of fractions", text: "const held = [0.5, 1.5];" },
  { name: "a Map", text: 'const held = new Map([["low", {}], ["high", {}]]);' },
  { name: "a Set", text: 'const held = new Set(["low", "high"]);' },
  { name: "a class", text: "class held { static low = {}; static high = {}; }" },
  { name: "a function", text: "function held() { return { low: {} }; }" },
  { name: "an arrow", text: "const held = () => ({ low: {} });" },
  { name: "an instance", text: "class Kind { low = {}; high = {}; }\nconst held = new Kind();" },
  { name: "what a call returns", text: "function build() { return { low: {}, high: {} }; }\nconst held = build();" },
  { name: "a text made at run time", text: 'const held = ["lo", "w"].join("");' },
  { name: "a written text", text: 'const held = "low";' },
  { name: "a regular expression", text: "const held = /low|high/g;" },
  { name: "a fraction", text: "const held = 0.25;" },
  { name: "a whole number", text: "const held = 7;" },
  { name: "a large whole number", text: "const held = 12345678901234567890n;" },
  { name: "a symbol", text: 'const held = Symbol("low");' },
  { name: "a typed array", text: "const held = new Uint8Array([1, 2, 3]);" },
  { name: "a frozen object", text: "const held = Object.freeze({ low: 1 });" },
  { name: "an object without a prototype", text: "const held = Object.assign(Object.create(null), { low: 1 });" },
  { name: "a closure over another variable", text: "const below = { low: 1 };\nconst held = () => below;" },
  { name: "a pattern's variable", text: "const { held } = { held: { low: {} } };" },
];

/** Code that never runs. `export` is taken away where the parts lie in one file. What `stores` needs a variable that can be stored to. */
const readers: readonly (Named & { stores?: true })[] = [
  { name: "nobody", text: "" },
  { name: "an exported function", text: "export function neverCalled() { return held; }" },
  { name: "an exported arrow", text: "export const neverCalled = () => held;" },
  { name: "a method of an exported class", text: "export class NeverMade { take() { return held; } }" },
  { name: "a static method", text: "export class NeverMade { static take() { return held; } }" },
  { name: "a field of an exported class", text: "export class NeverMade { taken = held; }" },
  { name: "a getter of an exported object", text: "export const neverRead = { get taken() { return held; } };" },
  { name: "an arrow two deep", text: "export function neverCalled() { return () => () => held; }" },
  { name: "a function of the file alone", text: "function neverCalled() { return held; }" },
  { name: "an async function", text: "export async function neverCalled() { return held; }" },
  { name: "a generator", text: "export function* neverCalled() { yield held; }" },
  { name: "a default of a parameter", text: "export function neverCalled(taken = held) { return taken; }" },
  { name: "typeof in a function", text: "export function neverCalled() { return typeof held; }" },
  { name: "a branch that is never taken", text: "if (process.argv.length > 99) console.log(held);" },
  { name: "a function that stores to it", text: "export function neverCalled() { held = 1; }", stores: true },
];

/** Each declares `column(name, empty)`, which returns a function of `load` and `save` that returns `{ read, write }`. */
const factories: readonly Named[] = [
  {
    name: "closures in a literal",
    text: `export function column(name, empty) {
  return (load, save) => ({
    read: () => load()[name] ?? empty,
    write: next => save(row => ({ ...row, [name]: next(row[name] ?? empty) })),
  });
}`,
  },
  {
    name: "an instance of a class",
    text: `class Cell {
  constructor(name, empty, load, save) { this.name = name; this.empty = empty; this.load = load; this.save = save; }
  read() { return this.load()[this.name] ?? this.empty; }
  write(next) { this.save(row => ({ ...row, [this.name]: next(row[this.name] ?? this.empty) })); }
}
export function column(name, empty) {
  return (load, save) => new Cell(name, empty, load, save);
}`,
  },
  {
    name: "bound functions",
    text: `function read(name, empty, load) { return load()[name] ?? empty; }
function write(name, empty, save, next) { save(row => ({ ...row, [name]: next(row[name] ?? empty) })); }
export function column(name, empty) {
  return (load, save) => ({ read: read.bind(null, name, empty, load), write: write.bind(null, name, empty, save) });
}`,
  },
  {
    name: "arrows three deep",
    text: `const inSteps = name => empty => (load, save) => ({
  read: () => load()[name] ?? empty,
  write: next => save(row => ({ ...row, [name]: next(row[name] ?? empty) })),
});
export function column(name, empty) {
  return inSteps(name)(empty);
}`,
  },
  {
    name: "a generator that is kept",
    text: `function* always(empty) { for (;;) yield empty; }
export function column(name, empty) {
  const steps = always(empty);
  return (load, save) => ({
    read: () => load()[name] ?? steps.next().value,
    write: next => save(row => ({ ...row, [name]: next(row[name] ?? steps.next().value) })),
  });
}`,
  },
  {
    name: "a getter",
    text: `export function column(name, empty) {
  const kept = { get empty() { return empty; } };
  return (load, save) => ({
    read: () => load()[name] ?? kept.empty,
    write: next => save(row => ({ ...row, [name]: next(row[name] ?? kept.empty) })),
  });
}`,
  },
];

const layouts = ["three files", "two files", "one file", "four files", "three CommonJS files", "an entry point that awaits an import"] as const; // prettier-ignore

const crossed = holders.flatMap(holds =>
  readers
    .filter(reads => !reads.stores || holds.isWritable)
    .flatMap(reads =>
      factories.flatMap(keeps =>
        layouts.flatMap(layout => [true, false].map(usesItToo => ({ holds, reads, keeps, layout, usesItToo }))),
      ),
    ),
);

export const programs = crossed.length;

const show = `function show(value) {
  if (typeof value === "function") return "function " + value.name + " " + Object.keys(value).join();
  if (typeof value === "symbol" || typeof value === "bigint") return typeof value + " " + String(value);
  if (value instanceof Map) return "map " + [...value.keys()].join();
  if (value instanceof Set) return "set " + [...value].join();
  if (value instanceof RegExp) return String(value);
  if (ArrayBuffer.isView(value)) return "view " + value.join();
  return JSON.stringify(value);
}
`;

const withoutExports = (text: string) => text.replace(/^export /gm, "");
const asCommonJS = (text: string) =>
  text
    .replace(/^export (async function\*?|function\*?|class) (\w+)/gm, "exports.$2 = $1 $2")
    .replace(/^export const (\w+) =/gm, "exports.$1 =");

export function programOf(index: number): { file: string; text: string; files?: Record<string, string> } {
  // Neighbors in the table differ in the entry point alone: a stride that shares no factor with the length of the table takes a run's share from all over it.
  const { holds, reads, keeps, layout, usesItToo } = crossed[(index * 7919) % crossed.length];
  const label = `${holds.name} | ${reads.name} | ${keeps.name} | ${layout} | ${usesItToo ? "the entry point uses the factory too" : "the entry point does not"}`;
  const entry = (
    imports: string,
  ) => `${imports}${show}${usesItToo ? 'const names = column("names", { first: 1 });\n' : ""}let row = {};
const load = () => row;
const save = change => { row = change(row); };
${usesItToo ? "const a = names(load, save);\n" : ""}const b = prices(load, save);
console.log(${JSON.stringify(label)} + ": " + ${usesItToo ? "show(a.read())" : '"-"'} + " " + show(b.read()));
b.write(cell => [cell, 1]);
console.log(show(row.prices[0]), row.prices[1], row.prices[0] === b.read()[0]);
`;
  const made = 'export const prices = column("prices", held);';
  const theFactory = usesItToo ? 'import { column } from "./tables.js";\n' : "";
  switch (layout) {
    case "three files":
      return {
        file: "main.js",
        text: entry(`import { prices } from "./prices.js";\n${theFactory}`),
        files: {
          "tables.js": keeps.text + "\n",
          "prices.js": `import { column } from "./tables.js";\n${holds.text}\n${made}\n${reads.text}\n`,
        },
      };
    case "two files":
      return {
        file: "main.js",
        text: entry(`import { prices${usesItToo ? ", column" : ""} } from "./prices.js";\n`),
        files: { "prices.js": `${keeps.text}\n${holds.text}\n${made}\n${reads.text}\n` },
      };
    case "one file":
      return {
        file: "main.js",
        text: `${withoutExports(keeps.text)}\n${holds.text}\n${withoutExports(made)}\n${withoutExports(reads.text)}\n${entry("")}`,
      };
    case "four files":
      return {
        file: "main.js",
        text: entry(`import { prices } from "./prices.js";\n${theFactory}`),
        files: {
          "tables.js": keeps.text + "\n",
          "held.js": `${holds.text}\nexport { held };\n${reads.text}\n`,
          "prices.js": `import { column } from "./tables.js";\nimport { held } from "./held.js";\nexport { held } from "./held.js";\n${made}\n`,
        },
      };
    case "three CommonJS files":
      return {
        file: "main.cjs",
        text: entry(
          `const { prices } = require("./prices.cjs");\n${usesItToo ? 'const { column } = require("./tables.cjs");\n' : ""}`,
        ),
        files: {
          "tables.cjs": asCommonJS(keeps.text) + "\n",
          "prices.cjs": `const { column } = require("./tables.cjs");\n${holds.text}\n${asCommonJS(made)}\n${asCommonJS(reads.text)}\n`,
        },
      };
    case "an entry point that awaits an import":
      return {
        file: "main.js",
        text: entry(
          `const { prices } = await import("./prices.js");\n${usesItToo ? 'const { column } = await import("./tables.js");\n' : ""}`,
        ),
        files: {
          "tables.js": keeps.text + "\n",
          "prices.js": `import { column } from "./tables.js";\n${holds.text}\n${made}\n${reads.text}\n`,
        },
      };
  }
}
