import { expect } from "bun:test";
import { bunExe } from "harness";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  formatModuleExports,
  parseModuleExports,
  type ListedModule,
} from "../../../src/codegen/builtins/collect-modules";
import { GeneratorError } from "../../../src/codegen/builtins/declarations";
import { run } from "../harness/run";
import { test } from "../supported";
import { observe as observeHere } from "./module-exports.fixture";

const fileName = "src/codegen/builtins/data/module-exports.txt";
const dataFile = join(import.meta.dir, "../../..", fileName);
const text = readFileSync(dataFile, "utf8");
const written = parseModuleExports(text, fileName);

// In a process of its own, where nothing has used the modules yet: module-exports.fixture.ts says why.
async function observe(): Promise<Map<string, ListedModule>> {
  const { stdout, stderr, exitCode } = await run([
    bunExe(),
    join(import.meta.dir, "module-exports.fixture.ts"),
    dataFile,
    fileName,
  ]);
  expect({ exitCode, stderr: exitCode ? stderr : "" }).toEqual({ exitCode: 0, stderr: "" });
  const elsewhere = new Map<string, ListedModule>(JSON.parse(stdout));
  const observed = new Map<string, ListedModule>();
  for (const [specifier, listed] of written)
    observed.set(specifier, elsewhere.get(specifier) ?? (await observeHere(specifier, listed)));
  return observed;
}

if (process.env.AOT_BUILTINS_UPDATE) {
  test("module-exports.txt takes the holder of each export and the marks of functions from the Bun under test", async () => {
    const updatedText = formatModuleExports(await observe());
    if (updatedText !== text) writeFileSync(dataFile, updatedText);
  });
} else {
  test("each export is held where module-exports.txt says", async () => {
    const observed = await observe();
    const failures = Array.from(written, ([specifier, listed]) =>
      listed.exports.flatMap((entry, index) => {
        const { holder } = observed.get(specifier)!.exports[index];
        return holder === entry.holder
          ? []
          : [`${specifier} ${entry.name}: ${holder} holds it, the file says ${entry.holder}`];
      }),
    ).flat();
    expect(failures).toEqual([]);
  });

  test("the object of a module is a function where module-exports.txt says so, and nowhere else", async () => {
    const observed = await observe();
    const marked = (modules: ReadonlyMap<string, ListedModule>) =>
      Array.from(modules).flatMap(([specifier, { isFunction }]) => (isFunction ? [specifier] : []));
    expect(marked(written)).toEqual(marked(observed));
    expect(written.get("node:events")?.isFunction).toBe(true);
    expect(written.get("node:fs")?.isFunction).toBe(false);
  });
}

test("the default export is the own `default` of the object where the loader finds one, and the object elsewhere", async () => {
  const holderOf = (specifier: string, name: string) =>
    written.get(specifier)?.exports.find(entry => entry.name === name)?.holder;
  expect(holderOf("bun:sqlite", "default")).toBe("Property");
  expect(Object.hasOwn(require("bun:sqlite"), "default")).toBe(true);
  expect(holderOf("node:fs", "default")).toBe("ModuleObject");
  expect(Object.hasOwn(require("node:fs"), "default")).toBe(false);
  expect(holderOf("node:fs", "readFileSync")).toBe("Property");
});

test("the programs import every module of module-exports.txt", () => {
  const imported = ["every-module", "modules-that-fail"].flatMap(name => {
    const program = join(import.meta.dir, `../programs/builtin-modules/default-export-and-namespace-of-${name}.js`);
    return Array.from(
      readFileSync(program, "utf8").matchAll(/^import default\d+, \* as namespace\d+ from "([^"]+)";$/gm),
      match => match[1],
    );
  });
  expect(imported.sort()).toEqual([...written.keys()].filter(specifier => specifier !== "bun:test").sort());
});

test("formatModuleExports writes what parseModuleExports reads", () => {
  expect(formatModuleExports(written)).toBe(text);
  const small = "a=function default x=namespace\nb default=namespace\nc default=property y\n";
  expect(formatModuleExports(parseModuleExports(small, fileName))).toBe(small);
  expect(parseModuleExports(small, fileName).get("a")).toEqual({
    isFunction: true,
    exports: [
      { name: "default", holder: "ModuleObject" },
      { name: "x", holder: "Namespace" },
    ],
  });
  expect(parseModuleExports(small, fileName).get("b")?.isFunction).toBe(false);
});

test("parseModuleExports rejects malformed text", () => {
  for (const malformed of [
    "a x=property\n",
    "a x=object\n",
    "a default=\n",
    "a default=property=namespace\n",
    "a=object x\n",
    "a= x\n",
    "a=function=function x\n",
    "a y x\n",
    "a x x=namespace\n",
    "b x\na x\n",
    "a  x\n",
    "a x",
  ]) {
    expect(() => parseModuleExports(malformed, fileName)).toThrow(GeneratorError);
  }
});
