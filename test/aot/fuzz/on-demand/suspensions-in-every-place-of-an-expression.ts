// Fixed seeds of fuzz/suspensions-in-every-place-of-an-expression.ts: generators, async functions and async generators that suspend between the operands of every kind of expression and statement,
// while their variables, objects and lists are changed. The lines tell what was read ahead of a suspension and what behind it.
import { Random } from "../../fuzz/random";
import { generate, kinds } from "../../fuzz/suspensions-in-every-place-of-an-expression";
import { generated } from "../../generated/run-generated";

const tsconfig = JSON.stringify({
  compilerOptions: {
    target: "esnext",
    module: "preserve",
    moduleResolution: "bundler",
    noEmit: true,
    strict: true,
    types: [],
  },
});

generated(
  "suspensions in every place of an expression",
  Array.from({ length: 120 }, (_, index) => ({
    name: `seed ${index + 1}, ${kinds[index % kinds.length]}.`,
    // Every run takes the first twelve seeds; AOT_GENERATED=all takes all.
    isAlwaysRun: index < 12,
    isOnlyCompiled: true as const,
    make: () => ({
      file: "main.ts",
      text: generate(new Random(index + 1), kinds[index % kinds.length]),
      files: { "tsconfig.json": tsconfig },
    }),
  })),
);
