// Fixed seeds of fuzz/several-changes-one-behind-the-other.ts: one object, two to four changes of it and of what stands above it in a drawn order, and two looks at what is left.
// Each program is also built where all code counts as hot, and as a very large program is.
import { Random } from "./fuzz/random";
import { generate } from "./fuzz/several-changes-one-behind-the-other";
import { generated } from "./generated/run-generated";

const forms: [string, string[]][] = [
  [".", []],
  [", where all code counts as hot.", ["--aot-heat=everything-is-hot"]],
  [", as a very large program.", ["--aot-heat=everything-is-cold", "--aot-limit=MaxWarmCodeValues:1"]],
];

generated(
  "an object answers alike behind several changes",
  Array.from({ length: 48 }, (_, index) => ({
    name: `seed ${Math.floor(index / 3) + 1}${forms[index % 3][0]}`,
    isAlwaysRun: index < 6,
    isOnlyCompiled: true as const,
    flags: forms[index % 3][1],
    make: () => ({ file: "main.js", text: generate(new Random(Math.floor(index / 3) + 1), false) }),
  })),
);
