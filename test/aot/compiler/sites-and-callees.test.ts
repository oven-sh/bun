// n calls in one function, each of the value of one variable that holds any of n functions: n sites that share n callees.
//
// Whatever looks at each callee at each site costs n * n, which quadruples as n doubles. A list of callees is made once for
// the build and a site names it, so n sites with n callees cost n + n, and twice the program may cost walk and sweep at most
// 2.1 times as much. What the program without a site and without a callee costs has nothing to do with n, so it is subtracted.
//
//   growth = (cost at 2n - cost at 0) / (cost at n - cost at 0)        for n = 64, 128, 256
//
// No clock is read: the build counts the instructions of the stage itself, on Linux.
import { expect } from "bun:test";
import { isASAN, isDebug, isLinux, tempDir } from "harness";
import { describe, test } from "../supported";
import { build, countsInstructions, stagesOf } from "./measure";

const sizes = [0, 64, 128, 256, 512];
const maxGrowth = 2.1;

function programOf(size: number) {
  const numbers = Array.from({ length: size }, (_, index) => index);
  return [
    ...numbers.map(index => `function h${index}(x) { return x; }`),
    `let handler = x => x;`,
    ...numbers.map(index => `handler = h${index};`),
    `function run(x) {`,
    ...numbers.map(() => `  x = handler(x);`),
    `  return x;`,
    `}`,
    `console.log(run(1), run(2));`,
    ``,
  ].join("\n");
}

async function instructionsOfWalk(size: number) {
  using folder = tempDir(`aot-sites-and-callees-${size}`, { "main.js": programOf(size) });
  const built = await build({ folder: String(folder), entry: "main.js" });
  const { instructions } = stagesOf(built).walk;
  if (instructions === undefined) throw new Error(`the build of ${size} sites and callees reports no instructions for walk and sweep`);
  return instructions;
}

const skipped =
  isDebug || isASAN
    ? "a debug or ASAN build works every shared answer out again at every site"
    : !isLinux || !countsInstructions()
      ? "only on Linux does a build count the instructions of a stage"
      : undefined;
if (skipped) console.error(`SKIPPED: test/aot/compiler/sites-and-callees.test.ts: ${skipped}`);

describe.skipIf(!!skipped)("compile/aot/sites and callees", () => {
  test(
    "n sites with n callees cost n + n",
    async () => {
      const [empty, ...costs] = await Promise.all(sizes.map(instructionsOfWalk));
      const added = costs.map(cost => cost - empty);
      const growths = added.slice(1).map((cost, index) => cost / added[index]);
      console.error(
        `SITES AND CALLEES: walk and sweep adds ${added.map((cost, index) => `${cost} at ${sizes[index + 1]}`).join(", ")}: grows ${growths.map(growth => growth.toFixed(2)).join(" | ")} times`,
      );
      for (const growth of growths) expect(growth).toBeLessThanOrEqual(maxGrowth);
    },
    1_800_000,
  );
});
