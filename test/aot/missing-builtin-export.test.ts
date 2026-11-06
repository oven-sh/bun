// What a program meets that imports a name a built-in module does not export: test/aot/parallel/builtin-modules/missing-exports-of-builtin-modules.
import { expect } from "bun:test";
import { readFileSync } from "fs";
import { isWindows } from "harness";
import { join } from "path";
import { parseModuleExports } from "../../src/codegen/builtins/collect-modules";
import { test } from "./supported";

const readLines = (path: string) =>
  readFileSync(join(import.meta.dir, "../../src", path), "utf8")
    .trimEnd()
    .split("\n");
// A name may be followed by "=" and where its value is, which builtins/module-exports.test.ts checks.
const namesOnly = (path: string) =>
  Array.from(
    parseModuleExports(readFileSync(join(import.meta.dir, "../../src", path), "utf8"), path),
    ([specifier, listed]) => [specifier, ...listed.exports.map(({ name }) => name)].join(" "),
  );
const lines = namesOnly("codegen/builtins/data/module-exports.txt");
const absentOnWindowsLines = readLines("codegen/builtins/data/module-exports-absent-on-windows.txt");
const nativeModules = readLines("jsc/modules/NativeModuleList.h").flatMap(
  line => /macro\("([^"]+)"_s, \w+\)/.exec(line)?.[1] ?? [],
);

// A name in this list is a known member: nothing tests for it at run time. So every name in it has to exist.
test("every name in src/codegen/builtins/data/module-exports.txt is exported", async () => {
  const absent: string[] = [];
  for (const line of lines) {
    const [specifier, ...names] = line.split(" ");
    const namespace = await import(specifier);
    for (const name of names) if (!(name in namespace)) absent.push(specifier + " " + name);
  }
  const taken = absentOnWindowsLines.flatMap(line =>
    line
      .split(" ")
      .slice(1)
      .map(name => line.split(" ")[0] + " " + name),
  );
  expect(absent).toEqual(isWindows ? taken : []);
  const all = new Set(
    lines.flatMap(line =>
      line
        .split(" ")
        .slice(1)
        .map(name => line.split(" ")[0] + " " + name),
    ),
  );
  expect(taken.filter(name => !all.has(name))).toEqual([]);
  expect(lines.length).toBeGreaterThan(70);
  // The generator wants both files in strict order.
  expect(lines.map(line => line.split(" ")[0])).toEqual(lines.map(line => line.split(" ")[0]).sort());
  for (const line of lines) expect(line.split(" ").slice(1)).toEqual(line.split(" ").slice(1).sort());
  const specifiers = lines.map(line => line.split(" ")[0]);
  expect(new Set(specifiers).size).toBe(specifiers.length);
  for (const line of lines) expect(new Set(line.split(" ").slice(1)).size).toBe(line.split(" ").length - 1);
  const native = nativeModules.filter(specifier => specifier !== "bun");
  expect(native.length).toBeGreaterThan(8);
  expect(native.filter(specifier => !specifiers.includes(specifier))).toEqual([]);
});

// `bun` exports every property of `Bun`, libc decides the exports of node:constants, and node:process exports the properties that `process` has when it is first linked.
// Compiled code looks up an unlisted name of these three at run time.
const decidedAtRunTime = ["bun", "node:constants", "node:process"];

// An import of a name that the line of any other native module does not list stops the build. So the line has to list every export.
test("src/codegen/builtins/data/module-exports.txt lists every export of a native module", async () => {
  const namesIn = (list: string[], specifier: string) =>
    list
      .find(line => line.startsWith(specifier + " "))
      ?.split(" ")
      .slice(1) ?? [];
  const closed = nativeModules.filter(specifier => !decidedAtRunTime.includes(specifier));
  expect(closed.length).toBeGreaterThan(6);
  const unlisted: string[] = [];
  for (const specifier of closed) {
    const absent = isWindows ? namesIn(absentOnWindowsLines, specifier) : [];
    const listed = namesIn(lines, specifier).filter(name => !absent.includes(name));
    for (const name of Object.keys(await import(specifier)))
      if (!listed.includes(name)) unlisted.push(specifier + " " + name);
  }
  expect(unlisted).toEqual([]);
});
