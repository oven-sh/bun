import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { join } from "node:path";
import { describe, test } from "../supported";
import { run } from "./run";

// Bun's own tests of its test runner start `bun test` on small projects and hold what Jest and Vitest print for them. Here each of those child runs gets
// `--aot`, so what the runner learns to do reaches compiled runs too, or shows up here.
// ../runner-suites.known.txt names the tests that still fail so, `<file>: <test>` a line. A test that fails and isn't named there fails its file here, and so
// does one that is named and passes: take its line out.
// `~ ` before a line: that test fails in some runs and passes in others.
//
// All of it takes half an hour of four processors. CI gives a file six minutes, beside another one. So ../runner-suites.test.ts and the files in
// ../runner-suites each hold a share that took some 250 seconds of processor time, and a suite that takes more is dealt over several files.
// Not here yet: test/cli/test/isolation.test.ts, of which a few tests run out of time on a busy machine without `--aot` too, and test/cli/test/parallel.test.ts.
const root = join(import.meta.dir, "..", "..", "..");
const preload = join(import.meta.dir, "children-under-aot.ts");
const known = readFileSync(join(import.meta.dir, "..", "runner-suites.known.txt"), "utf8")
  .split("\n")
  .filter(line => line && !line.startsWith("#"));
const nameOf = (line: string) => line.slice(7).replace(/ \[[\d.]+ms\]$/, "");

/**
 * Each is the path of a suite, or `<path> 2/4` for the second of four parts of one. The length of a test's name says which part it is in, so a test that
 * is added to the suite is in one of them.
 */
export function holdSuites(...parts: string[]) {
  // One after another: each keeps every processor busy by itself.
  describe("with its child runs under --aot", () => {
    test.each(parts)(
      "%s",
      async part => {
        const [suite, share = "1/1"] = part.split(" ");
        const [nth, of] = share.split("/").map(Number);
        using directory = tempDir("aot-runner-suites", { started: "" });
        const started = join(String(directory), "started");
        const env = { ...bunEnv, NO_COLOR: "1", AOT_CHILDREN_STARTED: started };
        const { stdout, stderr } = await run(
          [
            bunExe(),
            "test",
            "--preload",
            preload,
            "--timeout=300000",
            `--max-concurrency=${Math.min(20, availableParallelism())}`,
            ...(of > 1 ? ["-t", `^(?:[^]{${of}})*[^]{${nth - 1}}$`] : []),
            suite,
          ],
          root,
          env,
        );
        // A suite that started no compiled run has shown nothing.
        expect(readFileSync(started).length).toBeGreaterThan(0);
        // A failing test quotes what its child run printed, which has results of its own. Some runs list their own failures once more at the end.
        const lines = (stdout + "\n" + stderr).split("\n");
        const listed = lines.findLastIndex(line => /^\d+ tests? failed:$/.test(line));
        const failed = [...new Set(lines.slice(listed + 1).filter(line => line.startsWith("(fail) ")))];
        expect(` ${failed.length} fail`).toBe(lines.findLast(line => /^ *\d+ fail$/.test(line))!);
        const ran = new Set(lines.filter(line => /^\((?:pass|fail)\) /.test(line)).map(nameOf));
        const named = (mark: string) =>
          known
            .filter(line => line.startsWith(mark + suite + ": "))
            .map(line => line.slice(mark.length + suite.length + 2))
            .filter(name => of === 1 || ran.has(name));
        const names = failed.map(nameOf);
        expect(names.filter(name => !named("~ ").includes(name)).sort()).toEqual(named("").sort());
      },
      1_200_000,
    );
  });
}
