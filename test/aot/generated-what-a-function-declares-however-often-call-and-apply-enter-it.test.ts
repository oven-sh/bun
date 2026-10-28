// Fixed seeds of fuzz/what-a-function-declares-however-often-call-and-apply-enter-it.ts: a function is entered through call, apply, Reflect.apply or what is made of them. The place that enters it runs once or again
// (a loop, a getter, a conversion, a trap, a constructor, a timer), and another door may lead into the same function. The variables, closures, functions, classes and objects that it declares are made anew at each entry.
import { Random } from "./fuzz/random";
import { generate } from "./fuzz/what-a-function-declares-however-often-call-and-apply-enter-it";
import { generated } from "./generated/run-generated";

const seeds = Array.from({ length: 60 }, (_, index) => index + 1);

generated(
  "what a function declares is made anew at each entry, however often call and apply enter it",
  seeds.map((seed, index) => ({
    name: `seed ${seed}.`,
    isAlwaysRun: index < 16,
    isOnlyCompiled: true as const,
    flags: index % 3 === 1 ? ["--aot-heat=everything-is-hot"] : [],
    make: () => ({
      file: "main.js",
      text: generate(new Random(seed)),
      files: {},
    }),
  })),
);
