import { describe as describeOfBun, expect, test as testOfBun } from "bun:test";
import { bunEnv, bunExe, isASAN, tempDir } from "harness";
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
// `! ` before a line: that test fails, and in a Bun built with assertions one of them stops its child run: an invariant of the engine is broken there.
// `x64 ` or `arm64 ` before a line: that test fails on that architecture alone, and has to pass on the other.
//
// All of it takes half an hour of four processors. CI gives a file six minutes, beside another one. So ../runner-suites.test.ts and the files in
// ../runner-suites each hold a share that took some 250 seconds of processor time, and a suite that takes more is dealt over several files.
// Under a sanitizer a case should end within two minutes: a suite that takes longer there is dealt over more parts.
//
// It is a net, not the test of a fault, and the dearest family of this folder: an eighth of what all its files take. The benches behind a build run all of it, and CI the
// shares that have caught faults: ../every-build.txt.
const root = join(import.meta.dir, "..", "..", "..");
const listOf = (file: string) =>
  readFileSync(join(import.meta.dir, "..", file), "utf8")
    .split("\n")
    .filter(line => line && !line.startsWith("#"));
const nameOf = (line: string) => line.slice(7).replace(/ \[[\d.]+ms\]$/, "");

/**
 * Each is the path of a suite, or `<path> 2/4` for the second of four parts of one. The length of a test's name says which part it is in, so a test that
 * is added to the suite is in one of them. `<path> 2/4 2`: no more than two of its tests at a time, for a suite whose tests have short time limits of their own.
 */
export const holdSuites = (...parts: string[]) =>
  hold("with its child runs under --aot", "children-under-aot.ts", "runner-suites.known.txt", parts);

/** As holdSuites(). The file that calls this says what the suite has caught. */
export const holdSuitesInEveryRun = holdSuites;

/**
 * What no expectation of a suite asks: which files a child run runs, how often, in which realm and in which order. See children-say-when-they-run.ts.
 * ../runner-suites.runs.txt names the tests of which a child run does not run what a plain run runs, in the form of ../runner-suites.known.txt and by its rules.
 */
export const holdRunsOfSuites = (...parts: string[]) =>
  hold(
    "each child run under --aot runs what a plain run runs",
    "children-say-when-they-run.ts",
    "runner-suites.runs.txt",
    parts,
  );

/**
 * As holdSuites(), and the programs that a suite starts run compiled too: `bun <file>`, `bun run <file>`, `bun build --compile`. See children-run-compiled.ts.
 * ../runner-suites.programs.txt names the tests that fail so, in the form of ../runner-suites.known.txt and by its rules.
 */
export const holdProgramsOfSuites = (...parts: string[]) =>
  hold("with all that it starts compiled", "children-run-compiled.ts", "runner-suites.programs.txt", parts);

/**
 * As holdSuites(), but on the lane with a sanitizer, where a compiled child run takes six to twelve times as long: there every suite is skipped. AOT_EVERY_SUITE=1 runs them there too.
 * The file that calls this says why, and names the row that takes the skip off.
 */
export const holdSuitesOffSanitizers = (...parts: string[]) =>
  isASAN && !process.env.AOT_EVERY_SUITE
    ? describeOfBun.skip("with its child runs under --aot", () => void testOfBun.skip.each(parts)("%s", () => {}))
    : holdSuites(...parts);

function hold(title: string, preloaded: string, list: string, parts: string[]) {
  const preload = join(import.meta.dir, preloaded);
  const known = listOf(list);
  // One after another: each keeps every processor busy by itself.
  describe(title, () => {
    test.each(parts)(
      "%s",
      async part => {
        const [suite, share = "1/1", atATime = "20"] = part.split(" ");
        const [nth, of] = share.split("/").map(Number);
        using directory = tempDir("aot-runner-suites", { started: "", stopped: "" });
        const started = join(String(directory), "started");
        const stopped = join(String(directory), "stopped");
        // This test may run out of time, and whoever runs it may be ended: the suite ends with it, and its child runs with the suite.
        const env = {
          ...bunEnv,
          NO_COLOR: "1",
          AOT_CHILDREN_STARTED: started,
          AOT_CHILDREN_STOPPED: stopped,
          BUN_FEATURE_FLAG_NO_ORPHANS: "1",
        };
        const { stdout, stderr } = await run(
          [
            bunExe(),
            "test",
            "--preload",
            preload,
            "--timeout=300000",
            `--max-concurrency=${Math.min(Number(atATime), availableParallelism())}`,
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
        // The last count is the run's own. Where it is none, every failure above it is one that a child run printed, as some are meant to.
        const count = lines.findLast(line => /^ *\d+ fail$/.test(line))!;
        const printed = count === " 0 fail" ? [] : lines.slice(listed + 1).filter(line => line.startsWith("(fail) "));
        const failed = [...new Set(printed)];
        expect(` ${failed.length} fail`).toBe(count);
        const ran = new Set(lines.filter(line => /^\((?:pass|fail)\) /.test(line)).map(nameOf));
        const named = (mark: string) =>
          known
            .filter(line => line.startsWith(mark + suite + ": "))
            .map(line => line.slice(mark.length + suite.length + 2))
            .filter(name => of === 1 || ran.has(name));
        const names = failed.map(nameOf);
        // The names alone would hide a child run that was stopped, by an assertion of the engine for one: how each such run ended, and what it said of it.
        const quoted = (stdout + "\n" + stderr).split(/\n|\\n/);
        const stop =
          /ASSERTION FAILED|Unchecked JS exception|AddressSanitizer|LeakSanitizer|panic[:(]|Segmentation fault/;
        const said = quoted.flatMap((line, at) => (stop.test(line) ? quoted.slice(at, at + 4) : []));
        const ends = [...new Set([...readFileSync(stopped, "utf8").split("\n").filter(Boolean), ...said])];
        if (ends.length) console.error(`${part}: child runs were stopped:\n${ends.slice(0, 30).join("\n")}`);
        expect(names.filter(name => !named("~ ").includes(name)).sort()).toEqual(
          [...named(""), ...named("! "), ...named(process.arch + " ")].sort(),
        );
      },
      1_200_000,
    );
  });
}
