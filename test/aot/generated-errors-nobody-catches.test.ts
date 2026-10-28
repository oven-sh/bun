// Fixed seeds of fuzz/errors-nobody-catches.ts: errors and rejections of every kind that nobody catches, one after the other, heard by the handlers of the process or by nobody, and work behind each.
// Each program is also built as a very large program is.
import { generate } from "./fuzz/errors-nobody-catches";
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

generated(
  "errors that nobody catches leave nothing behind",
  Array.from({ length: 48 }, (_, index) => ({
    name: `seed ${(index >> 1) + 1}${index & 1 ? ", as a very large program." : "."}`,
    isAlwaysRun: index % 6 < 2,
    isOnlyCompiled: true as const,
    exitsAsPlainBunDoes: true as const,
    flags: index & 1 ? ["--aot-heat=everything-is-cold", "--aot-limit=MaxWarmCodeValues:1"] : [],
    make: () => ({
      file: "main.ts",
      text: generate(new Random((index >> 1) + 1)),
      files: { "tsconfig.json": tsconfig },
    }),
  })),
);
