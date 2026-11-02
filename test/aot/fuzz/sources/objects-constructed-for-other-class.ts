// A fixed list of seeds of ../objects-constructed-for-other-class.ts, which describes the programs.
import { generate } from "../objects-constructed-for-other-class";
import { Random } from "../random";
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

// These programs have no handler, and end with an uncaught error.
const endByAnError = [5, 20, 30, 51, 85, 87, 108, 114, 118, 124, 151, 181, 192, 196, 201];
// This seed links the prototypes of a function and its subclass into a cycle, which is rejected.
const ring = 5687;

export default family(
  "objects constructed for other class",
  [...Array.from({ length: 240 }, (_, index) => index), ring - 1].map(index => {
    const isTyped = index % 2 === 1;
    return {
      name: `seed ${index + 1}, ${isTyped ? "with types" : "without types"}.`,
      ...(endByAnError.includes(index + 1) ? {} : {}),
      make: () => ({
        file: isTyped ? "main.ts" : index % 4 === 0 ? "main.js" : "main.mjs",
        text: generate(new Random(index + 1), isTyped),
        files: isTyped ? { "tsconfig.json": tsconfig } : undefined,
      }),
    };
  }),
);
