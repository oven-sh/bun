// Fixed seeds of fuzz/tests-that-ask-which-runtime-this-is.ts: typeof Bun, globalThis.Bun, "Bun" in globalThis, process.versions.bun and their kin, asked about the global or about a parameter, a variable, a class or
// a caught value of the same name, in place or through a variable that is read ahead of its initializer, behind it, or after a second store. The executable goes the way that plain Bun goes.
import { Random } from "./fuzz/random";
import { generate } from "./fuzz/tests-that-ask-which-runtime-this-is";
import { generated } from "./generated/run-generated";

const seeds = Array.from({ length: 60 }, (_, index) => index + 1);

generated(
  "a program that asks which runtime this is goes the way it goes in plain Bun",
  seeds.map((seed, index) => ({
    name: `seed ${seed}.`,
    isAlwaysRun: index < 16,
    isOnlyCompiled: true as const,
    flags: [],
    make: () => ({
      file: "main.js",
      text: generate(new Random(seed)),
      files: {},
    }),
  })),
);
