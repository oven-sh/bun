// N pairs of classes: a base class whose constructor fills one field, and a class below it that fills another. Each lower class
// is stored on the global object under a computed name, so code that nobody sees may construct it or extend it. What the
// constructor of a base class allocates may then be an object of any of those classes, and each of them has all those
// allocations among its objects.
//
// With BUN_JSC_logAOTPhaseTimes=1 the flow analysis prints how many instructions each of its steps took. The program is built at
// two sizes on one thread. A step that goes over the classes once for each allocation takes four times as many at twice the
// size; no step may take more than `mostGrowth` times as many. A step that takes under `fewestMillionsJudged` million at the
// larger size is mostly work that does not depend on the size, and is not judged.
//
// The log has instructions on Linux x64 where perf_event_open may be used. Elsewhere nothing is judged, and the test says so.
import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isLinux, tempDir } from "harness";
import { join } from "node:path";
import { buildEnvironment, withThreads } from "./harness/flags";
import { run } from "./harness/run";
import { test } from "./supported";

const sizes = [400, 800];
const mostGrowth = 2.5;
const fewestMillionsJudged = 30;
const name = "test/aot/no-step-of-the-flow-analysis-takes-classes-times-allocations.test.ts";
const skipped =
  isDebug || isASAN
    ? "a debug or ASAN build counts other instructions"
    : !isLinux || process.arch !== "x64"
      ? "the log has instructions on Linux x64 alone"
      : undefined;
if (skipped) console.error(`SKIPPED: ${name}: ${skipped}`);

function sourceWith(pairs: number) {
  let source = "";
  for (let index = 0; index < pairs; index++)
    source +=
      `class Base${index} {\n  constructor() {\n    this.base${index} = ${index};\n  }\n}\n` +
      `class Below${index} extends Base${index} {\n  constructor() {\n    super();\n    this.below${index} = ${index};\n  }\n}\n`;
  source += "let sum = 0;\n";
  for (let index = 0; index < pairs; index++)
    source += `sum += new Below${index}().below${index};\nglobalThis["k" + sum] = Below${index};\n`;
  return source + "console.log(sum);\n";
}

/** Millions of instructions by step. A step that is printed more than once counts as one. */
function stepsOf(log: string) {
  const steps = new Map<string, number>();
  for (const line of log.split("\n")) {
    const found = /^AOT phase times: pass AnalyzeFlow \| (.+?) \| wall .* \| instructions ([0-9.e+]+) M/.exec(line);
    if (found) steps.set(found[1], (steps.get(found[1]) ?? 0) + Number(found[2]));
  }
  return steps;
}

test.skipIf(!!skipped)(
  "at twice the classes no step takes more than two and a half times the instructions",
  async () => {
    using dir = tempDir(
      "aot-classes-times-allocations",
      Object.fromEntries(sizes.map(size => [`pairs${size}.js`, sourceWith(size)])),
    );
    const directory = String(dir);
    const steps = [];
    for (const size of sizes) {
      const executable = join(directory, `pairs${size}`);
      const built = await run(
        [bunExe(), "build", "--compile", "--aot", withThreads(1), `pairs${size}.js`, "--outfile", executable],
        directory,
        { ...bunEnv, [buildEnvironment.logsPhaseTimes]: "1" },
      );
      expect(built.exitCode).toBe(0);
      expect((await run([executable], directory, bunEnv)).stdout).toBe(`${(size * (size - 1)) / 2}\n`);
      steps.push(stepsOf(built.stderr + built.stdout));
    }
    const [small, large] = steps;
    if (!large.size) {
      console.error(`SKIPPED: ${name}: perf_event_open may not be used here`);
      return;
    }
    const judged = [...large].filter(([, millions]) => millions >= fewestMillionsJudged);
    expect(judged.length).toBeGreaterThan(10);
    const tooFast = judged
      .filter(([step, millions]) => millions > mostGrowth * (small.get(step) ?? 0))
      .map(
        ([step, millions]) =>
          `${step}: ${Math.round(small.get(step) ?? 0)} M instructions at ${sizes[0]} pairs, ${Math.round(millions)} M at ${sizes[1]}`,
      );
    expect(tooFast).toEqual([]);
  },
  240_000,
);
