// Fixed seeds of fuzz/new-objects-kept-through-built-ins.ts: a function makes an object, a built-in keeps it somewhere, other code changes it through that place, and the function reads it again.
// Each program is also built where every call stays a call and all code counts as hot, and as a very large program is; each executable also runs with a collection at every n-th allocation that leaves the fast path.
import { generate } from "./fuzz/new-objects-kept-through-built-ins";
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
  [
    ", where every call stays a call and all code counts as hot.",
    ["--aot-disable=InlineCalls", "--aot-heat=everything-is-hot"],
  ],
  [", as a very large program.", ["--aot-heat=everything-is-cold", "--aot-limit=MaxWarmCodeValues:1"]],
];

generated(
  "whoever made an object reads what others have stored into it",
  Array.from({ length: 48 }, (_, index) => ({
    name: `seed ${Math.floor(index / 3) + 1}${forms[index % 3][0]}`,
    isAlwaysRun: index < 6,
    isOnlyCompiled: true as const,
    flags: forms[index % 3][1],
    alsoUnder: [{ BUN_JSC_slowPathAllocsBetweenGCs: "11" }],
    make: () => ({
      file: "main.ts",
      text: generate(new Random(Math.floor(index / 3) + 1)),
      files: { "tsconfig.json": tsconfig },
    }),
  })),
);
