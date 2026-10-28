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
  "../a-proxy-above-a-prototype.measure.ts",
  "../an-interface-over-what-a-plain-function-constructs-costs-no-more-than-erased.measure.ts",
  "../analysis-scaling/analysis-scaling.measure.ts",
  "../buns-own-tests-as-compiled-code.measure.ts",
  "../fields-created-by-name-cost-the-same-after-a-collection.measure.ts",
  "../generated-code.measure.ts",
  "../int32-lanes-cost-less-than-numbers.measure.ts",
  "../knowing-more-adds-no-code.measure.ts",
  "../long-functions-build-instructions.measure.ts",
  "../long-functions-build-time.measure.ts",
  "../long-functions-that-suspend-build-instructions.measure.ts",
  "../long-functions-with-calls-between-loads.measure.ts",
  "../long-functions-with-compound-assignments.measure.ts",
  "../long-functions-with-stores-between-reads.measure.ts",
  "../long-generated-functions.measure.ts",
  "../long-loop-bodies-build-instructions.measure.ts",
  "../long-try-blocks-build-instructions.measure.ts",
  "../many-constants-build-time.measure.ts",
  "../many-live-checked-values-build-time.measure.ts",
  "../many-stores-by-name-build-time.measure.ts",
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
  "../parsed-records-of-booleans.measure.ts",
  "./compare-builds.measure.ts",
  "./copies-in-cold-code.measure.ts",
  "./copies-of-ordinary-objects-in-cold-code.measure.ts",
  "./definitions-that-run-once.measure.ts",
  "./equivalent-forms.measure.ts",
  "./equivalent-syntax.measure.ts",
  "./evaluated-text-reads-names-above-functions.measure.ts",
  "./front-end.measure.ts",
  "./generated-code-of-idioms-1.measure.ts",
  "./generated-code-of-idioms-2.measure.ts",
  "./generated-code-of-idioms-3.measure.ts",
  "./generated-code-of-idioms-4.measure.ts",
  "./generated-code-of-idioms-5.measure.ts",
  "./generated-code-of-idioms-6.measure.ts",
  "./generated-code-of-idioms-7.measure.ts",
  "./generated-code-of-idioms-8.measure.ts",
  "./generated-code-of-idioms-9.measure.ts",
  "./generated-code-of-idioms-10.measure.ts",
  "./generated-code-of-idioms-11.measure.ts",
  "./generated-code-of-idioms-12.measure.ts",
  "./generated-code-of-idioms-13.measure.ts",
  "./generated-code-of-idioms-14.measure.ts",
  "./generated-code-of-idioms-15.measure.ts",
  "./generated-code-of-idioms-16.measure.ts",
  "./generated-code-of-idioms-17.measure.ts",
  "./generated-code-of-idioms-18.measure.ts",
  "./generated-code-of-idioms-19.measure.ts",
  "./generated-code-of-idioms-20.measure.ts",
  "./generated-code-of-idioms-21.measure.ts",
  "./generated-code-of-idioms-22.measure.ts",
  "./generated-code-of-idioms-23.measure.ts",
  "./generated-code-of-idioms-24.measure.ts",
  "./generated-code-of-idioms-25.measure.ts",
  "./generated-code-of-idioms-26.measure.ts",
  "./generated-code-of-operations-1.measure.ts",
  "./generated-code-of-operations-2.measure.ts",
  "./generated-code-of-operations-3.measure.ts",
  "./generated-code-of-operations-4.measure.ts",
  "./idioms-against-the-jit.measure.ts",
  "./idioms-in-a-very-large-program.measure.ts",
  "./idioms-in-parts-1.measure.ts",
  "./idioms-in-parts-2.measure.ts",
  "./idioms-in-parts-3.measure.ts",
  "./idioms-in-parts-4.measure.ts",
  "./idioms.measure.ts",
  "./lone-reads-in-cold-code.measure.ts",
  "./more-knowledge-costs-no-site.measure.ts",
  "./names-given-by-key.measure.ts",
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
  "./plain-bun-costs.measure.ts",
  "./serial-time.measure.ts",
  "./small-benchmarks.measure.ts",
  "../startup-scaling/startup-scaling-1.measure.ts",
  "../startup-scaling/startup-scaling-2.measure.ts",
  "../startup-scaling/startup-scaling-3.measure.ts",
  "../startup-scaling/startup-scaling-4.measure.ts",
  "../startup-scaling/startup-scaling-in-place.measure.ts",
  "../static-modules-slope.measure.ts",
  "../string-appends-take-linear-time.measure.ts",
  "../typed-package-costs-no-more-than-erased.measure.ts",
  "../typed-parse-key-order.measure.ts",
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
