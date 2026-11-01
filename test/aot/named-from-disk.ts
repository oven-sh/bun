// For ./named-from-disk-<part>.test.ts: one process took too much of what CI gives a file.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildEnvironment } from "./harness/flags";
import { run } from "./harness/run";
import { fromDisk, runTests, sources, standInOf } from "./harness/test-files-from-disk-reach-what-they-name";
// One by one: a case builds for minutes, and beside others it would pass its limit where Bun has a sanitizer.
import { testOneByOne as test } from "./supported";

export function namedFromDisk(part: number) {
  // One of four files. Each case builds a project of its own: all in one took longer than CI gives a file under ASAN.

  if (part === 1)
    test("a named file whose import finds nothing fails where a test loads it, and the other tests run", async () => {
      using dir = tempDir("aot-test-files-name-a-file-that-cannot-load", {
        "package.json": sources["package.json"],
        "src/counter.ts": sources["src/counter.ts"],
        "src/lacks.js": `import "./nothing-there.js";\nexport const a = 1;\n`,
        "src/above.js": `export { a } from "./lacks.js";\n`,
        // Sentences, not statements: the file loads, and so does what imports it.
        "src/mentions.ts": `/**
 * import { gone } from "./nothing-there.js"
 * Or \`import { gone } from "no-such-package/gone"\`.
 */
export const advice = 'as in import { name } from "./nothing-there-either.js"';
export function mentioned(): string { return "real"; }
`,
        "src/above-mentions.ts": `import { mentioned } from "./mentions";\nexport function above(): string { return mentioned(); }\n`,
        "tests/mentions.test.ts": `import { expect, spyOn, test } from "bun:test";
import * as mentions from "../src/mentions";
import { above } from "../src/above-mentions";
test("a file that only speaks of imports", () => {
  expect(above()).toBe("real");
  using spy = spyOn(mentions, "mentioned").mockReturnValue("spied on");
  expect(above()).toBe("spied on");
});
`,
        "tests/lacks.test.ts": `import { expect, test } from "bun:test";
test("a file that imports what is not there", async () => {
  expect(await import("../src/lacks.js").then(() => "loaded", error => error.name)).toBe("ResolveMessage");
});
test("a file above it", async () => {
  expect(await import("../src/above.js").then(() => "loaded", error => error.name)).toBe("ResolveMessage");
});
`,
        "tests/whole.test.ts": `import { expect, spyOn, test } from "bun:test";
import * as os from "node:os";
import * as tty from "tty";
import { increment } from "../src/counter";
test("a file beside them", () => {
  expect(increment()).toBe(1);
});
test("spies on exports of modules of Bun that no compiled file imports", () => {
  const spies = [spyOn(os, "hostname").mockReturnValue("spied on"), spyOn(tty, "isatty").mockReturnValue(true)];
  expect([os.hostname(), tty.isatty(987)]).toEqual(["spied on", true]);
  for (const spy of spies) spy.mockRestore();
});
`,
      });
      const plain = await runTests(String(dir), {});
      expect(plain.results.filter(result => result.startsWith("pass")).length).toBe(5);
      const shown = { ...fromDisk, BUN_DEBUG_TEST_AOT_WORDS: "TestRunShowsStandIn:1" };
      const compiled = await runTests(String(dir), shown, "--aot");
      expect({ results: compiled.results, exitCode: compiled.exitCode }).toEqual({
        results: plain.results,
        exitCode: 0,
      });
      const standIn = standInOf(compiled.stderr, "bun-test-files-from-disk.js");
      expect(standIn).toMatch(
        /import \* as (n\d+) from "[^"]*\/src\/mentions\.ts";[^]*\n  spyOn\(\1, "mentioned"\);\n/,
      );
      expect(standIn).toContain("/src/above-mentions.ts");
      expect(standIn).not.toContain("/src/lacks.js");
      expect(standIn).not.toContain("/src/above.js");
    }, 60_000);

  if (part === 1)
    test("require() of a file of data answers with the data until something has imported the file", async () => {
      using dir = tempDir("aot-test-files-from-disk-data", {
        "package.json": `{ "type": "module" }`,
        "src/compiled.json": `{ "name": "compiled", "list": [3] }`,
        "src/user.ts": `import data from "./compiled.json";\nexport const name: string = data.name;\n`,
        "tests/required.json": `{ "name": "required", "list": [1] }`,
        "tests/imported.json": `{ "name": "imported", "list": [2] }`,
        "tests/in-flight.json": `{ "name": "in flight", "list": [4] }`,
        "tests/settled.json": `{ "name": "settled", "list": [5] }`,
        "tests/data.test.js": `import { expect, test } from "bun:test";
import { name } from "../src/user";
import imported from "./imported.json";
test("required first", async () => {
  const required = require("./required.json");
  expect(required).toEqual({ name: "required", list: [1] });
  expect(Object.keys(required)).toEqual(["name", "list"]);
  expect(require("./required.json")).toBe(required);
  expect(Object.keys(await import("./required.json"))).toEqual(["default", "list", "name"]);
});
test("required again behind the import()", () => {
  expect(Object.keys(require("./required.json"))).toEqual(["name", "list"]);
});
test("required while an import() is in flight", async () => {
  const pending = import("./in-flight.json");
  expect(Object.keys(require("./in-flight.json"))).toEqual(["name", "list"]);
  await pending;
  expect(Object.keys(require("./in-flight.json"))).toEqual(["name", "list"]);
});
test("required behind an import() that has settled", async () => {
  await import("./settled.json");
  expect(Object.keys(require("./settled.json"))).toEqual(["default", "list", "name"]);
});
test("imported first by a test file", () => {
  expect(Object.keys(require("./imported.json"))).toEqual(["default", "list", "name"]);
  expect(imported.name).toBe("imported");
});
test("imported first by a compiled file", () => {
  expect(Object.keys(require("../src/compiled.json"))).toEqual(["default", "list", "name"]);
  expect(name).toBe("compiled");
});
`,
      });
      const plain = await runTests(String(dir), {});
      expect(plain.results.filter(result => result.startsWith("pass")).length).toBe(6);
      const compiled = await runTests(String(dir), fromDisk, "--aot");
      expect(compiled.results).toEqual(plain.results);
    }, 60_000);

  if (part === 1)
    test("what a test file calls is as hot as where the first file of an executable calls it", async () => {
      using dir = tempDir("aot-test-files-call-a-loop", {
        "package.json": sources["package.json"],
        "src/machine.js": `export class Machine {
  constructor(text) { this.text = text; this.at = 0; this.state = 0; this.words = 0; this.marks = 0; }
  next() { return this.at < this.text.length ? this.text.charCodeAt(this.at++) : -1; }
  inWord(code) { if (code === 32) { this.state = 0; } else if (code === 33) { this.marks++; this.state = 0; } }
  between(code) { if (code === 33) { this.marks++; } else if (code !== 32) { this.words++; this.state = 1; } }
  step(code) { switch (this.state) { case 0: this.between(code); break; case 1: this.inWord(code); break; } }
  run() { for (let code = this.next(); code !== -1; code = this.next()) this.step(code); return this.words * 1000 + this.marks; }
}
`,
        "src/work.js": `import { Machine } from "./machine.js";
export function work(times) { return new Machine("one two! three ".repeat(times)).run(); }
`,
        "main.js": `import { work } from "./src/work.js";\nconsole.log(work(1000));\n`,
        "tests/work.test.js": `import { expect, test } from "bun:test";
import { work } from "../src/work.js";
test("work", () => { expect(work(1000)).toBe(3001000); });
`,
      });
      // The last column of a function's row in the map: h for hot.
      const hotFunctions = (map: string) =>
        readFileSync(join(String(dir), map), "latin1")
          .split("\n")
          .map(row => row.split("\t"))
          .filter(columns => columns[0] === "F" && columns[10]?.endsWith("/src/machine.js") && columns[12] === "h")
          .map(columns => columns[7])
          .filter((name, index, names) => names.indexOf(name) === index)
          .sort();
      const built = await run(
        [bunExe(), "build", "--compile", "--aot", "./main.js", "--outfile", "program"],
        String(dir),
        {
          ...bunEnv,
          [buildEnvironment.mapFilePath]: join(String(dir), "executable.map"),
        },
      );
      expect(built.exitCode).toBe(0);
      const compiled = await runTests(
        String(dir),
        { ...fromDisk, [buildEnvironment.mapFilePath]: join(String(dir), "test-run.map") },
        "--aot",
      );
      expect({ results: compiled.results, exitCode: compiled.exitCode }).toEqual({
        results: ["pass work"],
        exitCode: 0,
      });
      expect(hotFunctions("executable.map")).toEqual(["Machine.next", "Machine.step"]);
      expect(hotFunctions("test-run.map")).toEqual(hotFunctions("executable.map"));
    }, 60_000);

  if (part === 2)
    test("the layer of the packages is told what the files above it name", async () => {
      using dir = tempDir("aot-files-above-the-packages-name", {
        "package.json": sources["package.json"],
        "node_modules/shapes/package.json": `{ "name": "shapes", "type": "module", "main": "index.js" }`,
        "node_modules/shapes/index.js": `export function area(side) { return side * side; }
export function neverNamed() { return "never named"; }
export class Box { constructor(side) { this.side = side; } twice() { return this.side * 2; } }
export * as deep from "./deep.js";
`,
        "node_modules/shapes/deep.js": `export const depth = 3;\nexport function dive() { return depth + 1; }\n`,
        "src/use.ts": `import { area, Box } from "shapes";
export function use(side: number): number { return area(side) + new Box(side).twice(); }
`,
        "tests/use.test.ts": `import { expect, spyOn, test } from "bun:test";
import * as shapes from "shapes";
import { use } from "../src/use";
test("what a file of the project names", () => {
  expect(use(3)).toBe(15);
});
test("what a test file names, and a spy", () => {
  expect(shapes.deep.dive()).toBe(4);
  const spy = spyOn(shapes, "area").mockReturnValue(1);
  expect(use(3)).toBe(7);
  spy.mockRestore();
  expect(use(3)).toBe(15);
});
`,
      });
      const plain = await runTests(String(dir), {});
      expect(plain.results.filter(result => result.startsWith("pass")).length).toBe(2);
      const layers = {
        BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:2,TestRunShowsStandIn:1,TestRunNamesPackages:1",
        BUN_AOT_TESTS_NAME_WHAT_THEY_USE: "1",
      };
      const compiled = await runTests(String(dir), layers, "--aot");
      expect({ results: compiled.results, exitCode: compiled.exitCode }).toEqual({
        results: plain.results,
        exitCode: 0,
      });
      const standIn = standInOf(compiled.stderr, "bun-test-files-above-packages.js");
      expect(standIn).toMatch(/\n  sink\(n0\.Box, n0\.area, n0\.deep\);\n  spyOn\(n0, "area"\);\n/);
      expect(standIn).not.toContain("neverNamed");
    }, 60_000);

  if (part === 2)
    test("the files of a folder that a test file lists name what they use as the test file does", async () => {
      using dir = tempDir("aot-test-files-list-a-folder", {
        "package.json": sources["package.json"],
        "src/counter.ts": sources["src/counter.ts"],
        "src/only-rows.ts": `export function onlyRows(): string { return "for the rows alone"; }\nexport function nobody(): string { return "nobody"; }\n`,
        "src/uses-counter.ts": `import { increment } from "./counter";\nexport function twice(): number { return increment() + increment(); }\n`,
        "tests/rows/first.rows.ts": `import { spyOn } from "bun:test";
import * as counter from "../../src/counter";
import { onlyRows } from "../../src/only-rows";
import { twice } from "../../src/uses-counter";
export function row(): string {
  using spy = spyOn(counter, "increment").mockReturnValue(20);
  return onlyRows() + " " + twice();
}
`,
        "tests/rows/deeper/second.rows.ts": `import current from "../../../src/counter";\nexport function row(): string { return "at " + current(); }\n`,
        "tests/rows.test.ts": `import { expect, test } from "bun:test";
import { readdirSync } from "node:fs";
const folder = new URL("./rows/", import.meta.url);
const project = new URL("../", import.meta.url);
test("every row of the folder", async () => {
  const said: string[] = [];
  for (const name of readdirSync(folder, { recursive: true }).map(String).filter(name => name.endsWith(".rows.ts")).sort())
    said.push((await import(new URL(name, folder).href)).row());
  expect(said).toEqual(["at 0", "for the rows alone 40"]);
  expect(readdirSync(project)).toContain("src");
});
`,
      });
      const plain = await runTests(String(dir), {});
      expect(plain.results).toEqual(["pass every row of the folder"]);
      const shown = { ...fromDisk, BUN_DEBUG_TEST_AOT_WORDS: "TestRunShowsStandIn:1" };
      const compiled = await runTests(String(dir), shown, "--aot");
      expect({ results: compiled.results, exitCode: compiled.exitCode }).toEqual({
        results: plain.results,
        exitCode: 0,
      });
      const standIn = standInOf(compiled.stderr, "bun-test-files-from-disk.js");
      expect(standIn).toMatch(/import \* as (n\d+) from "[^"]*\/src\/only-rows\.ts";[^]*\n  sink\(\1\.onlyRows\);\n/);
      expect(standIn).toMatch(/import \* as (n\d+) from "[^"]*\/src\/counter\.ts";[^]*\n  spyOn\(\1, "increment"\);\n/);
      expect(standIn).not.toContain("nobody");
    }, 60_000);
}
