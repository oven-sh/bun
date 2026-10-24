// Bun's own test files as compiled code: `bun test <file>` against `bun test --debug-aot <file>`, which compiles the file and all it imports and runs that. The verdicts are compared
// test by test (other-suites/bun-tests.ts). other-suites/bun-tests.same.txt lists the files of test/js and test/regression in which every test has the same verdict both ways.
//
// A run takes one file in eighty, others for each commit of Bun (run-programs.ts), and a few that every run takes:
//   AOT_SHARE=all bun test test/aot/buns-own-tests-as-compiled-code            every file: an hour at sixteen files at a time
//   AOT_PROGRAMS=<part of a path> bun test test/aot/buns-own-tests-as-compiled-code
import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isLinux, tempDir } from "harness";
import { readFileSync, writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { join } from "node:path";
import { inShare, takesWhatIsFixed, wanted } from "./run-programs";
import { beforeAll, describe, test } from "./supported";

const root = join(import.meta.dir, "..", "..");
const driver = join(import.meta.dir, "other-suites", "bun-tests.ts");
// Every run takes these. The first reads members of what `JSON.parse(text)` returns: a declaration somewhere below test/ that changes a type of the standard library for the whole project stops its build.
const inEveryRun = new Set(["test/js/bun/jsonc/jsonc.test.ts"]);
const files = readFileSync(join(import.meta.dir, "other-suites", "bun-tests.same.txt"), "utf8")
  .split("\n")
  .filter(
    file =>
      file &&
      (wanted === "" || wanted === "quick"
        ? (takesWhatIsFixed && inEveryRun.has(file)) || inShare(file, isASAN || isDebug ? 800 : 80, true)
        : file.includes(wanted)),
  );

/** What differs, one line each, by file. A test that runs out of its own time limit says little about the compiler. A file of which nothing was judged differs too. */
async function compare(files: string[], jobs: number): Promise<Map<string, string[]>> {
  using out = tempDir("buns-own-tests-as-compiled-code", {});
  writeFileSync(join(String(out), "list.txt"), files.join("\n"));
  await using child = Bun.spawn({
    cmd: [
      bunExe(),
      driver,
      "test",
      "--bun",
      bunExe(),
      "--list",
      join(String(out), "list.txt"),
      "--jobs",
      String(jobs),
      "--out",
      String(out),
    ],
    cwd: root,
    env: bunEnv,
    stdout: "ignore",
    stderr: "inherit",
  });
  await child.exited;
  const lines = readFileSync(join(String(out), "lines.txt"), "utf8").split("\n");
  return new Map(
    files.map(file => {
      const judged = lines.filter(line => line.split(" ")[1]?.replace(/:$/, "") === file);
      return [
        file,
        judged.length
          ? judged.filter(line => !/^(same|TIMES-OUT) /.test(line))
          : [`neither ${file}: the driver has no line for it`],
      ];
    }),
  );
}

// The list was made on Linux.
describe.skipIf(!isLinux)("every test has the verdict that it has in plain Bun", () => {
  let differences = new Map<string, string[]>();
  beforeAll(async () => {
    if (files.length) differences = await compare(files, Math.max(1, availableParallelism() - 1));
  }, 3_600_000);

  test.each(files)(
    "%s",
    async file => {
      const first = differences.get(file)!;
      if (first.length === 0) return;
      // Some of these tests ask for ports, clocks and other processes. What the compiler does to a test it does every time.
      const again = new Set((await compare([file], 1)).get(file));
      expect(first.filter(line => again.has(line))).toEqual([]);
    },
    900_000,
  );
});
