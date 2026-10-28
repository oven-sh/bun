// Fixed seeds of fuzz/several-changes-behind-a-declared-type.ts: one object behind a declared type, two to four changes that no type forbids in a drawn order, and two looks through the typed reference.
// Each program is also built where all code counts as hot, and as a very large program is.
import { Random } from "./fuzz/random";
import { generate } from "./fuzz/several-changes-behind-a-declared-type";
import { generated } from "./generated/run-generated";
import { tsconfig } from "./generated/typed-object-mutations";

const forms: [string, string[]][] = [
  [".", []],
  [", where all code counts as hot.", ["--aot-heat=everything-is-hot"]],
  [", as a very large program.", ["--aot-heat=everything-is-cold", "--aot-limit=MaxWarmCodeValues:1"]],
];

generated(
  "a typed reference answers alike behind several changes",
  Array.from({ length: 48 }, (_, index) => ({
    name: `seed ${Math.floor(index / 3) + 1}${forms[index % 3][0]}`,
    isAlwaysRun: index < 6,
    isOnlyCompiled: true as const,
    mayBeRefused: true as const,
    flags: forms[index % 3][1],
    make: () => ({
      file: "main.ts",
      text: generate(new Random(Math.floor(index / 3) + 1)),
      files: { "tsconfig.json": tsconfig },
    }),
  })),
);
