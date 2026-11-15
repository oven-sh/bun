import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// A file that the run itself writes, moves or removes is compared with the disk before it loads, keeps all its exports, and whoever loads it
// asks the run time. `rmSync(folder, { recursive: true })` is such a call for all that lies below the folder. `writeFileSync(folder, text)`
// fails, and `createWriteStream("", { fd })` names no file at all: joined to the working directory the empty path was the whole project, and
// every file of every package was taken for one that the run writes.
const dir = "import.meta.dir";
const lib = `join(${dir}, "lib")`;
const all = ["lib/one.js", "lib/two.js"];

const cases: Record<string, string[]> = {
  [`createWriteStream("", { fd: 1 })`]: [],
  [`rmSync("", { recursive: true })`]: [],
  [`writeFileSync(${dir}, "x")`]: [],
  [`appendFileSync(${lib}, "x")`]: [],
  [`truncateSync(${lib})`]: [],
  [`unlinkSync(${lib})`]: [],
  [`createWriteStream(${lib})`]: [],
  [`copyFileSync("other", ${lib})`]: [],
  [`symlinkSync("other", ${lib})`]: [],
  [`openSync(${lib}, "w")`]: [],
  [`Bun.write(${lib}, "x")`]: [],
  [`Bun.file(${lib}).delete()`]: [],
  [`rmSync(${lib})`]: [],
  [`rmSync(${lib}, { force: true })`]: [],
  [`rmSync(${lib}, { recursive: false })`]: [],
  [`rm(${lib}, () => {})`]: [],
  [`cpSync("other", ${lib})`]: [],

  [`writeFileSync(join(${lib}, "one.js"), "x")`]: ["lib/one.js"],
  [`rmSync(join(${lib}, "two.js"))`]: ["lib/two.js"],
  [`rmSync(${lib}, { recursive: true })`]: all,
  [`rmSync(${lib}, { force: true, recursive: process.argv.length > 0 })`]: all,
  [`rmSync(${lib}, options)`]: all,
  [`rmSync(${lib}, { ...options })`]: all,
  [`rm(${lib}, { recursive: true }, () => {})`]: all,
  [`cpSync("other", ${lib}, { recursive: true })`]: all,
  [`renameSync(${lib}, "other")`]: all,
  [`renameSync("other", ${lib})`]: all,
};

// The call never runs: the files on disk are those that were compiled.
const folderOf = (call: string) => ({
  "lib/one.js": `export const one = "one";\n`,
  "lib/two.js": `export const two = "two";\n`,
  "case.test.js": `
    import { test } from "bun:test";
    import {
      appendFileSync, copyFileSync, cpSync, createWriteStream, openSync, renameSync, rm, rmSync, symlinkSync, truncateSync, unlinkSync,
      writeFileSync,
    } from "node:fs";
    import { join } from "node:path";
    import { pkg } from "pkg";
    import { one } from "./lib/one.js";
    import { two } from "./lib/two.js";
    const options = { recursive: process.argv.length > 0 };
    test("it", () => {
      if (process.argv.length > 99) ${call};
      console.log("says|", import.meta.dir.split(/[\\\\/]/).at(-1), one, two, pkg);
    });`,
});

const line = "the run writes, moves or removes a file of its own, which is compared with the disk before it loads: ";

/** Each call in a folder of its own, all of them one project and one run. By folder: what its test printed, and which of its files the log of the build names as written. */
async function ran(calls: string[]) {
  const files: Record<string, string> = {
    "package.json": `{ "name": "p", "type": "module" }`,
    "node_modules/pkg/package.json": `{ "name": "pkg", "type": "module", "main": "index.js" }`,
    "node_modules/pkg/index.js": `export const pkg = "pkg";\n`,
  };
  for (const [index, call] of calls.entries())
    for (const [path, text] of Object.entries(folderOf(call))) files[`c${index}/${path}`] = text;
  using folder = tempDir("a-call-that-fails-on-a-folder", files);
  const env = { ...bunEnv, NO_COLOR: "1", BUN_JSC_logAOTPhaseTimes: "1" };
  const says = (stdout: string) =>
    stdout
      .split("\n")
      .filter(text => text.startsWith("says|"))
      .sort();
  const plain = await run([bunExe(), "test"], String(folder), bunEnv);
  const compiled = await run([bunExe(), "test", "--aot"], String(folder), env);
  const named = compiled.stderr.split("\n").flatMap(text => text.split(line).slice(1));
  const written = [...new Set(named.map(path => path.slice(path.indexOf(String(folder)) + String(folder).length + 1)))];
  expect(says(plain.stdout)).toEqual(calls.map((_, index) => `says| c${index} one two pkg`).sort());
  expect({ says: says(compiled.stdout), exitCode: compiled.exitCode }).toEqual({
    says: says(plain.stdout),
    exitCode: 0,
  });
  return calls.map((_, index) => written.filter(path => !path.startsWith("c") || path.startsWith(`c${index}/`)).sort());
}

// The empty path joined to the working directory is the whole project, so whoever takes it for a folder names every file of the run: each such call has a run of its own.
const isWholeProject = (call: string) => call.includes(`("",`);
const together = Object.keys(cases).filter(call => !isWholeProject(call));
let shared: ReturnType<typeof ran> | undefined;

for (const call of Object.keys(cases)) {
  test.concurrent(
    call,
    async () => {
      const written = isWholeProject(call)
        ? (await ran([call]))[0]
        : (await (shared ??= ran(together)))[together.indexOf(call)];
      const folder = isWholeProject(call) ? "c0" : `c${together.indexOf(call)}`;
      expect(written).toEqual(cases[call].map(path => `${folder}/${path}`));
    },
    240_000,
  );
}
