// Fixed seeds of fuzz/objects-made-for-another-class-than-the-one-that-runs.ts: small programs about one object that one constructor makes for another class (a new target beside, below or above it,
// `super()` that returns another object, another prototype behind the making), and what is then stored into it, asked of it and listed. Every line is printed at once. Half of the programs have written types.
import { generate } from "../objects-made-for-another-class-than-the-one-that-runs";
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

// These programs have no handler, and end by an error that nobody catches.
const endByAnError = [5, 20, 30, 51, 85, 87, 108, 114, 118, 124, 151, 181, 192, 196, 201];
// This seed links the prototypes of a function and of a class below it into a ring, which is refused.
const ring = 5687;

export default family(
  "objects made for another class than the one that runs",
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
