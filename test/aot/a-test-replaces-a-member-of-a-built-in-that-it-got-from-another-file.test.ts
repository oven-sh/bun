import { expect } from "bun:test";
import { casesOfOneRun, sayOf, type Way } from "./harness/cases-of-one-run";
import { runsWholeGrids } from "./harness/ways";
import { test } from "./supported";

// The test file never spells the object whose member it replaces: it gets the object, or the function that finds it, from a file
// of its project or from a module of Bun. Over layers that file lies in a program below, which is built first.
// The cases share the layers below them, so each replaces a member of its own and none puts it back by a store.
const compiled = (
  [
    [["--debug-aot"], "TestRunLayers:2"],
    [["--debug-aot"], "TestRunLayers:1"],
    [["--debug-aot"], "TestRunLayers:0"],
  ] satisfies Way[]
).filter(([, words]) => runsWholeGrids || words !== "TestRunLayers:1");
const project = casesOfOneRun(
  "a-test-replaces-a-member-of-a-built-in-that-it-got-from-another-file",
  { "package.json": `{ "name": "p", "type": "module" }` },
  [[[]], ...compiled],
);

function runsAsPlain(
  title: string,
  imports: string,
  body: string,
  others: Record<string, string> = {},
  printed = "replaced",
) {
  const name = project.add(
    name => `
      import { spyOn, test } from "bun:test";
      ${imports}
      ${sayOf(name)}
      const replaced = () => "replaced";
      test("${name}", async () => {
        try {
          ${body}
        } catch (error) {
          say("threw", error.name);
        }
      });`,
    others,
  );
  test(title, async () => {
    const plain = (await project.ran()).get(name);
    expect(plain).toEqual({ result: "pass", printed: printed + "\n" });
    for (const [flags, words] of compiled) expect((await project.ran(flags, words)).get(name)).toEqual(plain);
  });
}

runsAsPlain(
  "a file exports Object.getPrototypeOf, and a helper of that file stores",
  `import { first, getPrototypeOf, put } from "./tools.js";`,
  `put(getPrototypeOf(Uint8Array).prototype, "values", () => ["replaced"].values());
          say(first(new Uint8Array(2)));`,
  {
    "tools.js": `
      export const { getPrototypeOf } = Object;
      export function put(object, key, value) { object[key] = value; }
      export function first(list) { for (const item of list.values()) return item; }`,
  },
);

runsAsPlain(
  "a file exports Object.defineProperty too, and the member is a getter",
  `import { defineProperty, getPrototypeOf, lengthOf } from "./tools.js";`,
  `defineProperty(getPrototypeOf(Int8Array).prototype, "length", { get: replaced, configurable: true });
          say(lengthOf(new Int8Array(2)));`,
  {
    "tools.js": `
      export const { defineProperty, getPrototypeOf } = Object;
      export const lengthOf = list => list.length;`,
  },
);

runsAsPlain(
  "the function is exported in a list, under another name",
  `import { above } from "./tools.js";`,
  `above(Float32Array).prototype.fill = replaced;
          say(new Float32Array(1).fill(1));`,
  { "tools.js": `const protoOf = Object.getPrototypeOf; export { protoOf as above };` },
);

runsAsPlain(
  "a second file finds the object with the function of the first",
  `import { typed } from "./more.js";`,
  `typed.subarray = replaced;
          say(new Uint16Array(1).subarray());`,
  {
    "tools.js": `export const { getPrototypeOf } = Object;`,
    "more.js": `import { getPrototypeOf } from "./tools.js"; export const typed = getPrototypeOf(Uint16Array).prototype;`,
  },
);

runsAsPlain(
  "the function comes through export *",
  `import { above } from "./all.js";`,
  `above(BigInt64Array).prototype.at = replaced;
          say(new BigInt64Array(1).at(0));`,
  {
    "all.js": `export * from "./tools.js";`,
    "tools.js": `export const { getPrototypeOf: above } = Object;`,
  },
);

runsAsPlain(
  "a file exports two functions of another file again, and the second one finds the object",
  `import { defineProperty, getPrototypeOf } from "./all.js";`,
  `defineProperty(getPrototypeOf(Uint32Array).prototype, "byteLength", { get: replaced, configurable: true });
          say(new Uint32Array(1).byteLength);`,
  {
    "all.js": `export { defineProperty, getPrototypeOf } from "./tools.js";`,
    "tools.js": `export const { defineProperty, getPrototypeOf } = Object;`,
  },
);

runsAsPlain(
  "a file exports a name of another file again, and then all of them",
  `import { define, getPrototypeOf } from "./all.js";`,
  `define(getPrototypeOf(Float64Array).prototype, "byteOffset", { get: replaced, configurable: true });
          say(new Float64Array(1).byteOffset);`,
  {
    "all.js": `export { defineProperty as define } from "./tools.js"; export * from "./tools.js";`,
    "tools.js": `export const { defineProperty, getPrototypeOf } = Object;`,
  },
);

runsAsPlain(
  "the object is a property of what an ES module exports as default",
  `import tools from "./tools.js";`,
  `tools.holder.isInteger = replaced;
          say(Number.isInteger(1));`,
  { "tools.js": `export default { holder: Number };` },
);

runsAsPlain(
  "import() gives the object",
  "",
  `(await import("./tools.js")).proto.join = replaced;
          say([1].join());`,
  { "tools.js": `export const proto = Array.prototype;` },
);

runsAsPlain(
  "a CommonJS file exports an object that holds it",
  `const { holder } = require("./tools.cjs");`,
  `spyOn(holder, "keys").mockImplementation(replaced);
          say(Object.keys({}));`,
  { "tools.cjs": `module.exports = { holder: Object };` },
);

runsAsPlain(
  "a CommonJS file exports the object itself",
  "",
  `require("./tools.cjs").parse = replaced;
          say(JSON.parse("1"));`,
  { "tools.cjs": `module.exports = JSON;` },
);

runsAsPlain(
  "a CommonJS file stores it under a name of exports",
  `const tools = require("./tools.cjs");`,
  `tools.holder.ownKeys = replaced;
          say(Reflect.ownKeys({}));`,
  { "tools.cjs": `exports.holder = Reflect;` },
);

runsAsPlain(
  "a function of another file answers what stands above its operand",
  `import { above } from "./tools.js";`,
  `above(Uint8ClampedArray).prototype.indexOf = replaced;
          say(new Uint8ClampedArray(1).indexOf(0));`,
  { "tools.js": `export const above = object => Object.getPrototypeOf(object);` },
);

runsAsPlain(
  "a function of another file answers the prototype of its operand",
  `import { protoOf } from "./tools.js";`,
  `protoOf(Set).has = replaced;
          say(new Set().has(1));`,
  { "tools.js": `export function protoOf(constructor) { return constructor.prototype; }` },
);

runsAsPlain(
  "a static field of a class of another file holds the object",
  `import { Tools } from "./tools.js";`,
  `Tools.proto.charAt = replaced;
          say("a".charAt(0));`,
  { "tools.js": `export class Tools { static proto = String.prototype; }` },
);

runsAsPlain(
  "a function of another file stores the object into a variable that the file exports",
  `import { init, late } from "./tools.js";`,
  `init();
          late.getDay = replaced;
          say(new Date().getDay());`,
  { "tools.js": `export let late; export function init() { late = Date.prototype; }` },
);

runsAsPlain(
  "a map of another file holds the object",
  `import { table } from "./tools.js";`,
  `table.get("a").toFixed = replaced;
          say((1).toFixed());`,
  { "tools.js": `export const table = new Map([["a", Number.prototype]]);` },
);

runsAsPlain(
  "require() of node:console",
  "",
  `spyOn(require("node:console"), "debug").mockImplementation(replaced);
          say(console.debug());`,
);

runsAsPlain(
  "the default of node:console",
  `import imported from "node:console";`,
  `imported.info = replaced;
          say(console.info());`,
);

runsAsPlain(
  "the default of node:console out of import()",
  "",
  `(await import("node:console")).default.warn = replaced;
          say(console.warn());`,
);

runsAsPlain(
  "process.getBuiltinModule() of node:console",
  "",
  `process.getBuiltinModule("node:console").error = replaced;
          say(console.error());`,
);

runsAsPlain(
  "what import * as gives of node:console is another object than console",
  `import * as all from "node:console";`,
  `spyOn(all, "table").mockImplementation(replaced);
          say(all.table(), all !== console, all.default === console);`,
  {},
  "replaced true true",
);

runsAsPlain(
  "performance out of node:perf_hooks",
  `import { performance as clock } from "node:perf_hooks";`,
  `spyOn(clock, "now").mockImplementation(replaced);
          say(performance.now());`,
);

runsAsPlain(
  "URL out of node:url",
  `import { URL as Address } from "node:url";`,
  `Address.canParse = replaced;
          say(URL.canParse("x"));`,
);

runsAsPlain(
  "TextEncoder as a property of what require() of node:util gives",
  "",
  `require("node:util").TextEncoder.prototype.encode = replaced;
          say(new TextEncoder().encode("a"));`,
);

runsAsPlain(
  "TextDecoder taken apart from what require() of node:util gives",
  `const { TextDecoder: Decoder } = require("node:util");`,
  `Decoder.prototype.decode = replaced;
          say(new TextDecoder().decode());`,
);

runsAsPlain(
  "a file exports again what a module of Bun exports",
  `import { clock } from "./tools.js";`,
  `clock.mark = replaced;
          say(performance.mark("a"));`,
  { "tools.js": `export { performance as clock } from "node:perf_hooks";` },
);

const aroundWhatIsHanded = {
  "tools.js": `
      export const above = value => Object.getPrototypeOf(value);
      export const classOf = value => value.constructor;`,
};

runsAsPlain(
  "a helper of another file answers the prototype of what it is handed",
  `import { above } from "./tools.js";`,
  `above(new Set()).clear = replaced;
          say(new Set().clear());`,
  aroundWhatIsHanded,
);

runsAsPlain(
  "a helper of another file answers the class of what it is handed",
  `import { classOf } from "./tools.js";`,
  `classOf([]).from = replaced;
          say(Array.from([1]));`,
  aroundWhatIsHanded,
);

runsAsPlain(
  "a spy on the prototype of a text that a helper of another file was handed",
  `import { above } from "./tools.js";`,
  `spyOn(above("text"), "charCodeAt").mockImplementation(replaced);
          say(["a"].join("").charCodeAt(0));`,
  aroundWhatIsHanded,
);

runsAsPlain(
  "what the helper of another file is handed stands in a variable",
  `import { above } from "./tools.js";`,
  `const held = new Date(0);
          above(held).getUTCDay = replaced;
          say(new Date(0).getUTCDay());`,
  aroundWhatIsHanded,
);
