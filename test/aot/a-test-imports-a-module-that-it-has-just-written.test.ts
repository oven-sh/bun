import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

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

async function said(flags: string[]) {
  // A run leaves what it has written, so each gets a folder of its own.
  using dir = tempDir("aot-test-imports-what-it-wrote", { "tsconfig.json": "{}", "a.test.ts": testFile("a") });
  const directory = String(dir);
  const ran = await run([bunExe(), "test", ...flags, "./a.test.ts"], directory, { ...bunEnv, BUN_TMPDIR: directory });
  return {
    lines: (ran.stdout + "\n" + ran.stderr)
      .split("\n")
      .filter(line => line.startsWith("SAID"))
      .sort(),
    summary: ran.stderr.split("\n").filter(line => /^ *\d+ (pass|fail)$/.test(line)),
  };
}

test("it says what plain Bun says", async () => {
  const plain = await said([]);
  expect(plain.summary).toEqual([" 1 pass", " 0 fail"]);
  expect(plain.lines.length).toBe(18);
  expect(plain.lines).toContain("SAID a a literal, import() 1");
  expect(plain.lines).toContain("SAID a a path that the build folds 3");
  expect(await said(["--aot"])).toEqual(plain);
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
