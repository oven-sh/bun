// The generators under generated/python write random programs: `python3 <generator>.py <seed>` prints one, and the same seed always
// prints the same program. The top of each generator says what its programs are about.
//
//   bun test test/aot/generated-by-python                                  two programs of each generator
//   AOT_GENERATED=all bun test test/aot/generated-by-python                thirty of each
//   AOT_GENERATED=all AOT_GENERATED_SEEDS=1000..1200 bun test test/aot/generated-by-python
//   AOT_GENERATED="tail-calls 7" bun test test/aot/generated-by-python     one program
import { test } from "bun:test";
import { generators, headingOf, program, python } from "./generated/python-generators";
import { generated } from "./generated/run-generated";

const [first, last] = (process.env.AOT_GENERATED_SEEDS ?? "1..30").split("..").map(Number);
const seeds = Array.from({ length: last - first + 1 }, (_, i) => first + i);

if (!python) console.error("SKIPPED: test/aot/generated-by-python.test.ts: python3 is not installed");
if (!python) test.skip("python3 is not installed", () => {});
else {
  for (const [name, extension, options = {}] of generators) {
    const title = headingOf(name, extension);
    generated(
      title.replaceAll("-", " "),
      [...(options.seeds ?? seeds), ...(options.foundByFreshSeeds ?? [])]
        .filter(seed => !options.leftOut?.includes(seed))
        .map((seed, index) => ({
          name: `${title} ${seed}`,
          isAlwaysRun: index < 2,
          wasOnceWrong: options.foundByFreshSeeds?.includes(seed),
          plainEnv: options.plainEnv,
          failsToday: typeof options.failsToday === "string" ? options.failsToday : options.failsToday?.[seed],
          modeFailsToday: options.modeFailsToday?.[seed],
          make: () => program(name, extension, options, seed),
        })),
    );
  }
}
