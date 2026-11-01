import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { reads } from "./harness/reads";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(240_000);

// A test writes a module and loads it. Where the build knows the specifier, `import("./made.mjs")` or a path that it folds to one, the file is not there when the run is
// built: the loader is asked when the call runs. It has read the folder of the test file before, so it has to read it again.
const testFile = (tag: string) => `import { test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const ask = async (label: string, load: () => unknown) => {
  try { console.log("SAID ${tag}", label, await load()); }
  catch (error: any) { console.log("SAID ${tag}", label, "THROWS", error.constructor.name, error.code, String(error.message).replaceAll(import.meta.dirname, "<here>")); }
};
test("${tag}", async () => {
  const here = import.meta.dirname;
  writeFileSync(join(here, "${tag}-literal.mjs"), "export const said = 1;\\n");
  // @ts-ignore
  await ask("a literal, import()", async () => (await import("./${tag}-literal.mjs")).said);
  writeFileSync(join(here, "${tag}-literal.cjs"), "exports.said = 2;\\n");
  await ask("a literal, require()", () => require("./${tag}-literal.cjs").said);
  const folded = join(import.meta.dirname, "${tag}-folded.mjs");
  writeFileSync(folded, "export const said = 3;\\n");
  await ask("a path that the build folds", async () => (await import(folded)).said);
  writeFileSync(join(here, "${tag}-joined.mjs"), "export const said = 4;\\n");
  await ask("a path that it does not fold", async () => (await import(join(here, "${tag}-joined.mjs"))).said);
  mkdirSync(join(here, "${tag}-sub"), { recursive: true });
  writeFileSync(join(here, "${tag}-sub", "inner.mjs"), "export const said = 5;\\n");
  // @ts-ignore
  await ask("a literal in a folder made by the test", async () => (await import("./${tag}-sub/inner.mjs")).said);
  const temporary = mkdtempSync(join(tmpdir(), "written-"));
  writeFileSync(join(temporary, "far.mjs"), "export const said = 6;\\n");
  await ask("in a temporary folder", async () => (await import(join(temporary, "far.mjs"))).said);
  // @ts-ignore
  await ask("still missing, import()", async () => (await import("./${tag}-never.mjs")).said);
  await ask("still missing, require()", () => require("./${tag}-never.cjs").said);
  await ask("require.resolve() of the literal", () => require.resolve("./${tag}-literal.cjs").replaceAll(here, "<here>"));
  await ask("require.resolve(), still missing", () => require.resolve("./${tag}-never.cjs"));
  await ask("import.meta.require() of the literal", () => import.meta.require("./${tag}-literal.cjs").said);
  // @ts-ignore
  await ask("a package that is not there, import()", async () => (await import("${tag}-no-such-package")).said);
  await ask("a package that is not there, require()", () => require("${tag}-no-such-package").said);
  // @ts-ignore
  await ask("a literal in a folder that is not there", async () => (await import("./${tag}-no-folder/x.mjs")).said);
  await ask("a path into a folder that is not there", async () => (await import(join(here, "${tag}-no-folder", "y.mjs"))).said);
  rmSync(join(here, "${tag}-sub"), { recursive: true, force: true });
  // @ts-ignore
  await ask("a literal in a folder that the test has deleted", async () => (await import("./${tag}-sub/other.mjs")).said);
  await ask("a path into it", async () => (await import(join(here, "${tag}-sub", "another.mjs"))).said);
  // @ts-ignore
  await ask("the literal again", async () => (await import("./${tag}-literal.mjs")).said);
  rmSync(temporary, { recursive: true, force: true });
});
`;

test("it says what plain Bun says, alone, as one program and in two layers", async () => {
  const said = async (flags: string[], words: string, files: string[]) => {
    // A run leaves what it has written, so each gets a folder of its own.
    using dir = tempDir("aot-test-imports-what-it-wrote", {
      "tsconfig.json": "{}",
      "a.test.ts": testFile("a"),
      "b.test.ts": testFile("b"),
    });
    const directory = String(dir);
    const env = { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words, BUN_TMPDIR: directory };
    const ran = await run([bunExe(), "test", ...flags, ...files], directory, env);
    return {
      lines: (ran.stdout + "\n" + ran.stderr)
        .split("\n")
        .filter(line => line.startsWith("SAID"))
        .sort(),
      summary: ran.stderr.split("\n").filter(line => /^ *\d+ (pass|fail)$/.test(line)),
    };
  };
  const workers = ["--isolate", "--parallel=2"];
  const alone = await said([], "", ["./a.test.ts"]);
  expect(alone.summary).toEqual([" 1 pass", " 0 fail"]);
  expect(alone.lines.length).toBe(18);
  expect(alone.lines).toContain("SAID a a literal, import() 1");
  expect(alone.lines).toContain("SAID a a path that the build folds 3");
  expect(await said(["--aot"], "", ["./a.test.ts"])).toEqual(alone);
  const both = await said(workers, "", ["."]);
  expect(both.lines.length).toBe(36);
  expect(await said(["--aot"], "", ["."])).toEqual(both);
  expect(await said(["--aot", ...workers], "TestRunLayers:0", ["."])).toEqual(both);
  expect(await said(["--aot", ...workers], "TestRunLayers:2,TestRunPartFiles:1", ["."])).toEqual(both);
});

// The loader reads a folder again where it has found nothing, and looks once more. It does that once.
test("a load that finds nothing ends, in a plain run, a compiled one and an executable", async () => {
  const program = `import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const here = process.cwd();
const made = (...parts: string[]) => join(here, ...parts) + ".mjs".slice(process.argv.length > 90 ? 1 : 0);
const ask = async (label: string, load: () => unknown) => {
  try { console.log("SAID", label, await load()); } catch (error: any) { console.log("SAID", label, "THROWS", error.code); }
};
// @ts-ignore
await ask("relative, import()", async () => (await import("./never.mjs")).said);
await ask("relative, require()", () => require("./never.cjs").said);
await ask("absolute", async () => (await import(made("never-either"))).said);
// @ts-ignore
await ask("bare, import()", async () => (await import("no-such-package")).said);
await ask("bare, require()", () => require("no-such-package").said);
// @ts-ignore
await ask("relative, in a folder that is not there", async () => (await import("./no-folder/x.mjs")).said);
await ask("absolute, in a folder that is not there", async () => (await import(made("no-folder", "y"))).said);
mkdirSync(join(here, "gone"), { recursive: true });
writeFileSync(join(here, "gone", "x.mjs"), "export const said = 1;\\n");
await ask("a folder that is there", async () => typeof (await import(made("gone", "x"))).said);
rmSync(join(here, "gone"), { recursive: true, force: true });
await ask("the folder is deleted", async () => (await import(made("gone", "y"))).said);
for (let i = 0; i < 300; i++) { try { require("./never" + (i % 3) + ".cjs"); } catch {} }
console.log("SAID the end");
`;
  const forms: [string, string[][]][] = [
    ["plain", [[bunExe(), "main.ts"]]],
    ["bun run --aot", [[bunExe(), "run", "--aot", "main.ts"]]],
    [
      "an executable",
      [[bunExe(), "build", "--compile", "--aot", "--target=bun", "./main.ts", "--outfile", "x"], ["./x"]],
    ],
    [
      "an executable that loads code from disk",
      [
        [
          bunExe(),
          "build",
          "--compile",
          "--aot",
          "--aot-allow-code-from-disk",
          "--target=bun",
          "./main.ts",
          "--outfile",
          "x",
        ],
        ["./x"],
      ],
    ],
  ];
  for (const [form, commands] of forms) {
    using dir = tempDir("aot-load-that-finds-nothing", { "tsconfig.json": "{}", "main.ts": program });
    const directory = String(dir);
    let last = { stdout: "", exitCode: -1 };
    let took = 0;
    for (const [first, ...rest] of commands) {
      const began = performance.now();
      last = await run([first === "./x" ? join(directory, "x") : first, ...rest], directory, bunEnv);
      took = performance.now() - began;
    }
    const lines = last.stdout.split("\n").filter(line => line.startsWith("SAID"));
    expect({ form, exitCode: last.exitCode, lines: lines.length, end: lines.at(-1) }).toEqual({
      form,
      exitCode: 0,
      lines: 10,
      end: "SAID the end",
    });
    for (const label of [
      "relative, import()",
      "absolute",
      "bare, import()",
      "relative, in a folder that is not there",
      "the folder is deleted",
    ])
      expect({ form, line: lines.find(line => line.startsWith("SAID " + label + " ")) }).toEqual({
        form,
        line: `SAID ${label} THROWS ERR_MODULE_NOT_FOUND`,
      });
    // My first form of the second look went round for a minute, to 16 GB.
    reads(`a module that is not there, ${form}`, took / 1000, 30, "s");
    expect({ form, isQuick: took < 30_000 }).toEqual({ form, isQuick: true });
  }
});

// What decides is whether the program may load code from disk, which a test run may and an executable may by an option.
test("an executable that loads code from disk loads a file that it has just written, under a name that is written out", async () => {
  const program = `import { writeFileSync } from "node:fs";
import { join } from "node:path";
// In an executable import.meta.dirname is no folder on disk.
const here = process.cwd();
const ask = async (label: string, load: () => unknown) => {
  try { console.log("SAID", label, await load()); } catch (error: any) { console.log("SAID", label, "THROWS", error.code); }
};
writeFileSync(join(here, "made.mjs"), "export default 7;\\n");
writeFileSync(join(here, "made.cjs"), "module.exports = 8;\\n");
// @ts-ignore
await ask("import()", async () => (await import("./made.mjs")).default);
await ask("require()", () => require("./made.cjs"));
// @ts-ignore
await ask("still missing, import()", async () => (await import("./never.mjs")).default);
await ask("still missing, require()", () => require("./never.cjs"));
`;
  const said = async (commands: string[][]) => {
    using dir = tempDir("aot-executable-loads-what-it-wrote", { "tsconfig.json": "{}", "main.ts": program });
    const directory = String(dir);
    let last = { stdout: "", exitCode: -1 };
    for (const [first, ...rest] of commands)
      last = await run([first === "./x" ? join(directory, "x") : first, ...rest], directory, bunEnv);
    return { lines: last.stdout.split("\n").filter(line => line.startsWith("SAID")), exitCode: last.exitCode };
  };
  const plain = await said([[bunExe(), "main.ts"]]);
  expect(plain).toEqual({
    lines: [
      "SAID import() 7",
      "SAID require() 8",
      "SAID still missing, import() THROWS ERR_MODULE_NOT_FOUND",
      "SAID still missing, require() THROWS MODULE_NOT_FOUND",
    ],
    exitCode: 0,
  });
  const build = [bunExe(), "build", "--compile", "--aot", "--aot-allow-code-from-disk", "--target=bun"];
  expect(await said([[...build, "./main.ts", "--outfile", "x"], ["./x"]])).toEqual(plain);
});
