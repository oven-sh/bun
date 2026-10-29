// fuzz/short-counted-loops-with-everything-in-their-bodies.ts: functions that are called very often hold a loop with a constant
// start, step and bound that takes zero to nine turns. The body breaks, continues, returns, throws, catches, writes the counter and makes
// closures over it. One seed in four is a CommonJS file that is not strict.
import { Random } from "../random";
import { generate } from "../short-counted-loops-with-everything-in-their-bodies";
import { endless } from "../family";

export default endless("short counted loops compute what they compute in plain Bun", index => ({
  name: `seed ${index + 1}.`,
  flags: index % 8 === 5 ? ["--aot-heat=everything-is-hot"] : index % 8 === 6 ? ["--aot-heat=everything-is-cold"] : [],
  make: () => ({ file: index % 4 === 3 ? "main.cjs" : "main.mjs", text: generate(new Random(index + 1)) }),
}));
