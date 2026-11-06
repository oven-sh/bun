// The programs under parallel/builtin-modules and library-sweeps are compiled and compared with plain Bun. Every module that this Bun lists in
// `builtinModules` is imported or required under a written name by one of them: a module that Bun gains is added to a program there.
import { Glob } from "bun";
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { join } from "node:path";

// The entry point itself under another name.
const notLoadedByName = ["bun:main"];

test("every built-in module is named in a program", () => {
  const named = new Set<string>();
  for (const folder of [join(import.meta.dir, "parallel", "builtin-modules"), join(import.meta.dir, "library-sweeps")])
    for (const file of new Glob("**/*.{js,cjs,mjs,ts,cts,mts,tsx}").scanSync(folder))
      for (const [, name] of readFileSync(join(folder, file), "utf8").matchAll(
        /(?:\bfrom|\bimport|\bimport\(|\brequire\()\s*["']([^"'\n]+)["']/g,
      ))
        named.add(name.replace(/^node:/, ""));
  expect(builtinModules.length).toBeGreaterThan(70);
  expect(
    builtinModules.filter(name => !notLoadedByName.includes(name) && !named.has(name.replace(/^node:/, ""))),
  ).toEqual([]);
});
