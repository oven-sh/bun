import { expect } from "bun:test";
import { test } from "./harness/declare";
import { closed, completeness, external } from "./runtime-use-expectations";
import { of } from "./runtime-use-harness";

const custom = `const custom = Symbol.for("nodejs.util.inspect.custom");\n`;

test.each([
  ["module.require is printed", `const load = module.require; console.log(load);`],
  ["require is printed", `console.log(require);`],
  ["import.meta.require is printed", `console.log(import.meta.require);`],
  ["require is printed inside an object", `console.log({ load: require }, [require]);`],
  ["Bun.inspect prints require", `console.log(Bun.inspect(require).length);`],
  [
    "what stands above require is asked for",
    `console.log(Object.getPrototypeOf(module.require) === Function.prototype);`,
  ],
])("the report stays closed where %s", async (_, text) => {
  expect(completeness(await of(text))).toEqual(closed);
});

test.each([
  ["code nobody sees is handed require", external + `external(require);`],
  [
    "a method that the formatter calls on require calls it",
    custom +
      `const load: any = module.require;\nload[custom] = function (this: any) { return this(process.argv[2]); };\nconsole.log(load);`,
  ],
  [
    "a method that every function inherits calls its receiver",
    custom +
      `(Function.prototype as any)[custom] = function (this: any) { return this(process.argv[2]); };\nconsole.log(module.require);`,
  ],
  [
    "a conversion to a string calls require",
    `const load: any = module.require;\nload.toString = function (this: any) { return this(process.argv[2]); };\nconsole.log("%s", load);`,
  ],
  [
    "a row of a table runs a getter of require",
    `const load: any = module.require;\nObject.defineProperty(load, "loaded", { enumerable: true, get(this: any) { return this(process.argv[2]); } });\nconsole.table([load]);`,
  ],
])("the report is open where %s", async (_, text) => {
  expect((await of(text)).whyOpen).not.toEqual([]);
});
