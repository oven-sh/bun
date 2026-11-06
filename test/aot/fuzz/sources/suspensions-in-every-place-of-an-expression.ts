// Fixed seeds of fuzz/suspensions-in-every-place-of-an-expression.ts: generators, async functions and async generators that suspend between the operands of every kind of expression and statement,
// while their variables, objects and lists are changed. The lines tell what was read ahead of a suspension and what behind it.
import { Random } from "../random";
import { generate, kinds } from "../suspensions-in-every-place-of-an-expression";
import { family } from "../family";

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

export default family(
  "suspensions in every place of an expression",
  Array.from({ length: 120 }, (_, index) => ({
    name: `seed ${index + 1}, ${kinds[index % kinds.length]}.`,
    make: () => ({
      file: "main.ts",
      text: generate(new Random(index + 1), kinds[index % kinds.length]),
      files: { "tsconfig.json": tsconfig },
    }),
  })),
);
