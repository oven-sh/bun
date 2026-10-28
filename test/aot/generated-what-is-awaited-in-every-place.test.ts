// Each program is also built as a very large program is.
import { generated } from "./generated/run-generated";
import { testPrograms, tsconfig } from "./generated/what-is-awaited-in-every-place";

// `bun run` prints `return undefined` as `return`, and an async generator awaits only a `return` that has an operand. These are Node's answers too.
const written: Record<string, Record<string, string>> = {
  "return-of-an-async-generator, seen": { "undefined | ": "4 turns, {value:undefined,done:true}" },
  "requests-that-wait-in-line, seen": {
    "undefined | ":
      '8 turns, [{status:"fulfilled",value:{value:undefined,done:false}},{status:"fulfilled",value:{value:undefined,done:false}},{status:"fulfilled",value:{value:undefined,done:true}},{status:"fulfilled",value:{value:"late",done:true}},{status:"fulfilled",value:{value:undefined,done:true}}] | sent "second" at 1',
  },
};

generated(
  "an await resumes after the same number of turns of the job queue",
  testPrograms().flatMap(({ name, text }, index) =>
    [false, true].map(isLarge => ({
      name: `${name}${isLarge ? ", as a very large program." : "."}`,
      isAlwaysRun: (index + Number(isLarge)) % 3 === 0,
      isOnlyCompiled: true as const,
      flags: isLarge ? ["--aot-heat=everything-is-cold", "--aot-limit=MaxWarmCodeValues:1"] : [],
      written: written[name],
      make: () => ({ file: "main.ts", text, files: { "tsconfig.json": tsconfig } }),
    })),
  ),
);
