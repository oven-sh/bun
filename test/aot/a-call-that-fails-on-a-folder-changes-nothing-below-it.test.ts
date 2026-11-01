import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { waysFor } from "./harness/ways";
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
  [`writeFileSync("", "x")`]: [],
  [`rmSync("", { recursive: true })`]: [],
  [`writeFileSync(".", "x")`]: [],
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
const project = (call: string) => ({
  "package.json": `{ "name": "p", "type": "module" }`,
  "node_modules/pkg/package.json": `{ "name": "pkg", "type": "module", "main": "index.js" }`,
  "node_modules/pkg/index.js": `export const pkg = "pkg";\n`,
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
      console.log("says|", one, two, pkg);
    });`,
});

const line = "the run writes, moves or removes a file of its own, which is compared with the disk before it loads: ";

const ways: [string[], string][] = [
  [[], ""],
  [["--isolate"], "TestRunLayers:2,TestRunPartFiles:1"],
];
// The build of a layer does not see the test files. A file that one of them names itself comes down to it among those that may load again,
// of which the log has no such line. A folder comes down as a folder.
const namesOneFile = (call: string) => cases[call].length === 1;

// What is asked is how the look through the test files reads a call, which is the same look in both ways. One call of each kind of answer goes through the layers too.
const witnesses = [
  `createWriteStream("", { fd: 1 })`,
  `rmSync(join(${lib}, "two.js"))`,
  `rmSync(${lib}, { recursive: true })`,
];

for (const call of Object.keys(cases)) {
  for (const [flags, words] of waysFor(ways, witnesses.includes(call))) {
    test.concurrent(
      `${call}: ${JSON.stringify(flags)} ${words}`,
      async () => {
        using folder = tempDir("a-call-that-fails-on-a-folder", project(call));
        const env = { ...bunEnv, NO_COLOR: "1", BUN_DEBUG_TEST_AOT_WORDS: words, BUN_JSC_logAOTPhaseTimes: "1" };
        const says = (stdout: string) => stdout.split("\n").filter(text => text.startsWith("says|"));
        const plain = await run([bunExe(), "test", ...flags], String(folder), bunEnv);
        const compiled = await run([bunExe(), "test", "--aot", ...flags], String(folder), env);
        const named = compiled.stderr.split("\n").flatMap(text => text.split(line).slice(1));
        expect({
          says: says(compiled.stdout),
          exitCode: compiled.exitCode,
          written: [
            ...new Set(named.map(path => path.slice(path.indexOf(String(folder)) + String(folder).length + 1))),
          ].sort(),
        }).toEqual({ says: says(plain.stdout), exitCode: 0, written: words && namesOneFile(call) ? [] : cases[call] });
        expect(says(plain.stdout)).toEqual(["says| one two pkg"]);
      },
      240_000,
    );
  }
}
