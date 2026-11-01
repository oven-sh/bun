import { expect } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { test } from "./harness/declare";
import { startsToolsOfTheEngine } from "./harness/tests-that-start-tools-of-the-engine";

const folder = import.meta.dir;
const testFiles = [...new Bun.Glob("**/*.test.{ts,tsx,js,mjs,cjs}").scanSync(folder)].filter(
  path => !path.includes("node_modules"),
);
const nameForRunner = (path: string) => join("aot", path);

test("the three that a list kept by hand had missed, and one of each folder", () => {
  for (const path of [
    "a-generator-stepped-by-name-makes-no-result-objects.test.ts",
    "a-list-keeps-what-is-proven-of-it-beside-a-copy-onto-array-prototype.test.ts",
    "a-line-that-can-tell-nothing-fails-its-program.test.ts",
    "engine-tests.test.ts",
    "engine/ir-1.test.ts",
    "engine/native-1.test.ts",
    "cli/library-types.test.ts",
  ])
    expect([path, startsToolsOfTheEngine(nameForRunner(path))]).toEqual([path, true]);
});

test("a test that imports none of it, and a test outside this folder", () => {
  expect(startsToolsOfTheEngine(nameForRunner("engine-private-names-avoid-runtime.test.ts"))).toBe(false);
  expect(startsToolsOfTheEngine(join("js", "bun", "util", "which.test.ts"))).toBe(false);
});

// The runner reads texts, because Node runs it. Bun's own scan of a file's imports says what it may not miss.
test("no test file imports the file that finds the tools unseen", () => {
  const transpilers = { ts: new Bun.Transpiler({ loader: "ts" }), tsx: new Bun.Transpiler({ loader: "tsx" }) };
  // A file that is no program is imported by nobody.
  const scan = (file: string) => {
    try {
      return transpilers[file.endsWith(".ts") ? "ts" : "tsx"].scanImports(readFileSync(file, "utf8"));
    } catch {
      return [];
    }
  };
  const finder = join(folder, "shell", "find-tools.ts");
  const importedBy = new Map<string, string[]>();
  const filesImportedBy = (file: string) => {
    let imported = importedBy.get(file);
    if (!imported) {
      imported = scan(file)
        .filter(({ path }) => path.startsWith("."))
        .flatMap(({ path }) => {
          try {
            return [Bun.resolveSync(path, dirname(file))];
          } catch {
            return [];
          }
        })
        .filter(path => !relative(folder, path).startsWith(".."));
      importedBy.set(file, imported);
    }
    return imported;
  };
  const imports = (path: string) => {
    const seen = new Set([resolve(folder, path)]);
    for (const file of seen) {
      if (file === finder) return true;
      for (const imported of filesImportedBy(file)) seen.add(imported);
    }
    return false;
  };
  expect(testFiles.length).toBeGreaterThan(500);
  expect(testFiles.filter(path => imports(path) && !startsToolsOfTheEngine(nameForRunner(path)))).toEqual([]);
  expect(testFiles.filter(imports).length).toBeGreaterThan(20);
});
