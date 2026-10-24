// Fixed seeds of fuzz/two-names-where-ways-meet.ts: two names for one object, one of which is given another object on a way that is seldom taken; where the ways have met, each still names its own object.
// Each program is also built with every function hot.
import { Random } from "./fuzz/random";
import { generate } from "./fuzz/two-names-where-ways-meet";
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
const onceWrong = [9, 17, 27, 32, 54, 65, 74];

generated(
  "two names are two objects once one of them was given another",
  Array.from({ length: 160 }, (_, index) => ({
    name: `seed ${(index >> 1) + 1}${index & 1 ? ", every function hot." : "."}`,
    isAlwaysRun: false,
    wasOnceWrong: onceWrong.includes((index >> 1) + 1),
    isOnlyCompiled: true as const,
    flags: index & 1 ? ["--aot-heat=everything-is-hot"] : [],
    make: () => ({
      file: "main.ts",
      text: generate(new Random((index >> 1) + 1)),
      files: { "tsconfig.json": tsconfig },
    }),
  })),
);
