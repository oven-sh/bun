import { expect } from "bun:test";
import { casesOfOneRun, sayOf } from "./harness/cases-of-one-run";
import { test } from "./supported";

// The cases share the layers below them, so each adds a name of its own.
const project = casesOfOneRun("a-test-adds-a-name-to-the-prototype-of-generator-or-async-functions", {
  "package.json": `{ "name": "p", "type": "module" }`,
});

function runsAsPlain(title: string, object: string, reader: string, declarations = "") {
  const name = project.add(
    name => `
      import { test } from "bun:test";
      ${sayOf(name)}
      ${declarations}
      test("${name}", () => {
        const holder = ${object};
        try {
          holder.${name}Stored = "stored";
          Object.defineProperty(holder, "${name}Defined", { value: "defined", configurable: true });
          say((${reader}).${name}Stored, (${reader}).${name}Defined);
        } catch (error) {
          say("threw", error.name);
        }
      });`,
  );
  test(title, async () => {
    const plain = (await project.ran()).get(name);
    expect(plain).toEqual({ result: "pass", printed: "stored defined\n" });
    expect((await project.ran(["--debug-aot"], "TestRunLayers:2")).get(name)).toEqual(plain);
    expect((await project.ran(["--debug-aot"], "TestRunLayers:0")).get(name)).toEqual(plain);
  });
}

runsAsPlain("of a generator function", `Object.getPrototypeOf(function* () {})`, `function* () {}`);
runsAsPlain("of an async function", `Object.getPrototypeOf(async function () {})`, `async function () {}`);
runsAsPlain("of an async arrow function", `Reflect.getPrototypeOf(async () => {})`, `async () => {}`);
runsAsPlain("of an async generator function", `(async function* () {}).__proto__`, `async function* () {}`);
runsAsPlain("of a declared generator function", `Object.getPrototypeOf(walk)`, `walk`, `function* walk() {}`);
runsAsPlain("of a declared async function", `Object.getPrototypeOf(load)`, `load`, `async function load() {}`);
runsAsPlain(
  "of a generator function in a variable",
  `Object.getPrototypeOf(walk)`,
  `walk`,
  `const walk = function* () {};`,
);
runsAsPlain(
  "of a generator method",
  `Object.getPrototypeOf(tools.walk)`,
  `tools.walk`,
  `const tools = { *walk() {} };`,
);
runsAsPlain(
  "of an async generator method of a class",
  `Object.getPrototypeOf(new Tools().walk)`,
  `new Tools().walk`,
  `class Tools { async *walk() {} }`,
);
runsAsPlain("by the constructor of an async function", `(async () => {}).constructor.prototype`, `async () => {}`);
runsAsPlain("of generators", `Object.getPrototypeOf(function* () {}).prototype`, `(function* () {})()`);
runsAsPlain(
  "of async generators",
  `Object.getPrototypeOf(async function* () {}).prototype`,
  `(async function* () {})()`,
);
runsAsPlain(
  "above the prototype of a generator function",
  `Object.getPrototypeOf(walk.prototype)`,
  `walk()`,
  `function* walk() {}`,
);
runsAsPlain(
  "above the prototype of an async generator function",
  `walk.prototype.__proto__`,
  `walk()`,
  `async function* walk() {}`,
);
runsAsPlain(
  "two steps above a generator",
  `Object.getPrototypeOf(Object.getPrototypeOf(walk()))`,
  `walk()`,
  `function* walk() {}`,
);
runsAsPlain(
  "two steps above a generator in a variable",
  `Object.getPrototypeOf(Object.getPrototypeOf(walker))`,
  `walker`,
  `function* walk() {}
      const walker = walk();`,
);
