// Fixed seeds of fuzz/constant-lists-changed-by-every-road.ts: lists of constants at the top of a module, asked what they hold, changed by one road each, and asked again.
// Each program is also built where all code counts as hot, and as a very large program is.
import { generate } from "./fuzz/constant-lists-changed-by-every-road";
import { Random } from "./fuzz/random";
import { generated } from "./generated/run-generated";

const tsconfig = JSON.stringify({
  compilerOptions: {
    target: "esnext",
    module: "preserve",
    moduleResolution: "bundler",
    allowJs: true,
    noEmit: true,
    strict: true,
    types: [],
  },
});
const forms: [string, string[]][] = [
  [".", []],
  [", where all code counts as hot.", ["--aot-heat=everything-is-hot"]],
  [", as a very large program.", ["--aot-heat=everything-is-cold", "--aot-limit=MaxWarmCodeValues:1"]],
];

generated(
  "a list of constants answers what it holds now",
  Array.from({ length: 48 }, (_, index) => ({
    name: `seed ${Math.floor(index / 3) + 1}${forms[index % 3][0]}`,
    isAlwaysRun: index < 6,
    isOnlyCompiled: true as const,
    flags: forms[index % 3][1],
    make: () => ({
      file: "main.ts",
      text: generate(new Random(Math.floor(index / 3) + 1)),
      files: { "tsconfig.json": tsconfig },
    }),
  })),
);
