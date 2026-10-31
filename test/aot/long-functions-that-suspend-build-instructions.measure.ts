import { isASAN, isDebug, isWindows } from "harness";
import { expectLinearInstructionCount } from "./long-functions-instructions";
import { indexesUpTo, type Program } from "./long-functions-programs";
import { test } from "./supported";

const isSlowBuild = isDebug || isASAN;

const kinds = {
  "an async function": {
    head: "async function",
    suspend: (value: string) => `await pass(${value})`,
    run: "console.log(await large(1));",
  },
  "a generator": {
    head: "function*",
    suspend: (value: string) => `yield ${value}`,
    run: "{ const steps = large(1); let step = steps.next(); while (!step.done) step = steps.next(step.value); console.log(step.value); }",
  },
  "an async generator": {
    head: "async function*",
    suspend: (value: string) => `yield await pass(${value})`,
    run: "{ const steps = large(1); let step = await steps.next(); while (!step.done) step = await steps.next(step.value); console.log(step.value); }",
  },
};

// One local in three is read again behind the last suspension, so each suspension keeps a third of the locals before it.
const writeLocalsKeptOverSuspensions =
  ({ head, suspend, run }: (typeof kinds)[keyof typeof kinds]) =>
  (count: number): Program => {
    const indexes = indexesUpTo(count);
    const kept = indexes.filter(index => index % 3 === 0);
    let sum = 1;
    const values = indexes.map(index => {
      const value = sum + index;
      sum += value % 5;
      return value;
    });
    return {
      source: `const pass = async value => value;
${head} large(seed) {
  let sum = seed;
${indexes.map(index => `  const local${index} = ${suspend(`sum + ${index}`)};\n  sum += local${index} % 5;`).join("\n")}
  return sum${kept.map(index => ` + local${index}`).join("")};
}
${run}
`,
      output: `${kept.reduce((total, index) => total + values[index], sum)}\n`,
    };
  };

// The locals that the suspensions keep grow by sixteen when the function grows by four: that part is small at these sizes.
test.skipIf(isSlowBuild || isWindows).each(Object.entries(kinds))(
  "the instructions of a build follow the number of suspensions of %s that keeps many locals",
  async (_, kind) => {
    await expectLinearInstructionCount(250, writeLocalsKeptOverSuspensions(kind), 7.5);
  },
  240_000,
);
