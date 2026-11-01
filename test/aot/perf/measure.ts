// Runs the measures of `bun build --compile --aot`: what counts executed instructions, which takes a counter of the processor that the machines of CI do not
// have, and what takes minutes. ./README.md says what each holds and when to run it.
//
//   bun test/aot/perf/measure.ts                          all of them
//   bun test/aot/perf/measure.ts pinned-everyday idioms   those whose path holds one of the words
//   --at-once=4                                           so many files at a time. Each takes the processors it finds (AOT_PROGRAMS_JOBS)
//   --list                                                only names them
//
// Each is a file of bun:test, named from this folder, and can be run alone: `bun test ./test/aot/perf/<path>`. Prints a line a file and ends with 1 if one of them failed.
import { join } from "node:path";

const measures = [
  "../buns-own-tests-as-compiled-code.measure.ts",
  "../long-functions-build-instructions.measure.ts",
  "../minifying-first-saves-no-code-1.measure.ts",
  "../minifying-first-saves-no-code-2.measure.ts",
  "../minifying-first-saves-no-code-3.measure.ts",
  "../minifying-first-saves-no-code-4.measure.ts",
  "../minifying-first-saves-no-code-5.measure.ts",
  "../minifying-first-saves-no-code-6.measure.ts",
  "../minifying-first-saves-no-code-7.measure.ts",
  "../minifying-first-saves-no-code-8.measure.ts",
  "../minifying-first-saves-no-code-9.measure.ts",
  "../minifying-first-saves-no-code-10.measure.ts",
  "../minifying-first-saves-no-code-11.measure.ts",
  "../minifying-first-saves-no-code-12.measure.ts",
  "../minifying-first-saves-no-code-13.measure.ts",
  "../minifying-first-saves-no-code-14.measure.ts",
  "../minifying-first-saves-no-code-15.measure.ts",
  "../minifying-first-saves-no-code-16.measure.ts",
  "../no-step-of-the-flow-analysis-takes-classes-times-allocations.measure.ts",
  "./compare-builds.measure.ts",
  "./copies-of-ordinary-objects-in-cold-code.measure.ts",
  "./definitions-that-run-once.measure.ts",
  "./idioms-against-the-jit.measure.ts",
  "./idioms-in-a-very-large-program.measure.ts",
  "./idioms-in-parts-1.measure.ts",
  "./idioms-in-parts-2.measure.ts",
  "./idioms-in-parts-3.measure.ts",
  "./idioms-in-parts-4.measure.ts",
  "./idioms.measure.ts",
  "./operations.measure.ts",
  "./options-spread-over-what-a-literal-already-holds.measure.ts",
  "./pinned-applications.measure.ts",
  "./pinned-everyday-idioms-1.measure.ts",
  "./pinned-everyday-idioms-2.measure.ts",
  "./pinned-everyday-idioms-3.measure.ts",
  "./pinned-everyday-idioms-4.measure.ts",
  "./pinned-everyday-idioms-5.measure.ts",
  "./pinned-everyday-idioms-6.measure.ts",
  "./pinned-everyday-idioms-7.measure.ts",
  "./pinned-everyday-idioms-8.measure.ts",
  "./pinned-everyday-idioms-cold-1.measure.ts",
  "./pinned-everyday-idioms-cold-2.measure.ts",
  "./pinned-everyday-idioms-cold-3.measure.ts",
  "./pinned-everyday-idioms-cold-4.measure.ts",
  "./pinned-everyday-idioms-cold-5.measure.ts",
  "./pinned-everyday-idioms-cold-6.measure.ts",
  "./pinned-everyday-idioms-cold-7.measure.ts",
  "./pinned-everyday-idioms-cold-8.measure.ts",
  "./plain-bun-costs.measure.ts",
  "./serial-time.measure.ts",
  "./small-benchmarks.measure.ts",
  "../startup-scaling/startup-scaling-1.measure.ts",
  "../startup-scaling/startup-scaling-2.measure.ts",
  "../startup-scaling/startup-scaling-3.measure.ts",
  "../startup-scaling/startup-scaling-4.measure.ts",
  "../startup-scaling/startup-scaling-by-name.measure.ts",
  "../startup-scaling/startup-scaling-in-place.measure.ts",
  "../static-modules-slope.measure.ts",
];

const words = process.argv.slice(2).filter(word => !word.startsWith("--"));
const atOnce = Number(process.argv.find(word => word.startsWith("--at-once="))?.slice(10)) || 1;
const wanted = measures.filter(path => !words.length || words.some(word => path.includes(word)));
if (process.argv.includes("--list")) {
  console.log(wanted.join("\n"));
  process.exit(0);
}

const failed: string[] = [];
let next = 0;
await Promise.all(
  Array.from({ length: atOnce }, async () => {
    while (next < wanted.length) {
      const path = wanted[next++];
      const began = performance.now();
      const child = Bun.spawn({
        cmd: [process.execPath, "test", "--timeout=1800000", join(import.meta.dir, path)],
        cwd: join(import.meta.dir, "..", "..", ".."),
        env: { ...process.env, NO_COLOR: "1" },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
      const counts = Array.from(stderr.matchAll(/^ *(\d+ (?:pass|fail|skip|todo))$/gm), ([, count]) => count).join(
        ", ",
      );
      console.log(
        `${exitCode ? "FAIL" : "ok  "} ${path}: ${counts}, ${Math.round((performance.now() - began) / 1000)} s`,
      );
      if (!exitCode) continue;
      failed.push(path);
      console.log(stdout + stderr);
    }
  }),
);
console.log(`${wanted.length - failed.length} of ${wanted.length} files pass`);
process.exit(failed.length ? 1 : 0);
