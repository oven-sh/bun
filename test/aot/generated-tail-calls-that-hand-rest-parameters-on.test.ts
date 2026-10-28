// Fixed seeds of fuzz/tail-calls-that-hand-rest-parameters-on.ts: functions that end in a call to one another and hand their rest
// parameters on print what they print in plain Bun, however long the chain is. Every second seed is TypeScript.
import { Random } from "./fuzz/random";
import { generate } from "./fuzz/tail-calls-that-hand-rest-parameters-on";
import { generated } from "./generated/run-generated";

const tsconfig = JSON.stringify({
  compilerOptions: {
    target: "esnext",
    module: "preserve",
    moduleResolution: "bundler",
    allowJs: true,
    noEmit: true,
    strict: true,
    types: ["bun-types"],
  },
});

const tooSlow: number[] = [];
// Every run takes these, whatever else it takes.
const onceWrong = [584];

generated(
  "tail calls that hand rest parameters on end as in plain Bun",
  [...Array(160).keys(), ...onceWrong.map(seed => seed - 1)].map(index => ({
    name: `seed ${index + 1}.`,
    // Every run takes the first sixteen seeds; AOT_GENERATED=all takes all.
    isAlwaysRun: index < 16,
    wasOnceWrong: onceWrong.includes(index + 1),
    isOnlyCompiled: true as const,
    flags: index % 4 === 3 ? ["--aot-heat=everything-is-hot"] : index % 4 === 2 ? ["--aot-validate"] : [],
    ...(tooSlow.includes(index + 1) ? { failsToday: "does not end in time" } : {}),
    make: () => ({
      file: (index + 1) % 2 === 1 ? "main.ts" : "main.mjs",
      text: generate(new Random(index + 1), (index + 1) % 2 === 1),
      files: { "tsconfig.json": tsconfig },
    }),
  })),
);
