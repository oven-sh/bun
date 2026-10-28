// Fixed seeds of fuzz/ways-out-of-blocks-loops-and-finally.ts: labeled blocks, loops, `switch` and `try` inside each other, left by `break`, `continue`, `return` and `throw`, also out of `finally`,
// in functions, generators and async functions. Each function is called twelve times and takes another road each time. They print every step on the road.
import { Random } from "./fuzz/random";
import { generate, kinds } from "./fuzz/ways-out-of-blocks-loops-and-finally";
import { generated } from "./generated/run-generated";

generated(
  "ways out of blocks, loops and finally",
  Array.from({ length: 120 }, (_, index) => ({
    name: `seed ${index + 1}, ${kinds[index % kinds.length]}.`,
    // Every run takes the first twelve seeds; AOT_GENERATED=all takes all.
    isAlwaysRun: index < 12,
    isOnlyCompiled: true as const,
    make: () => ({ file: "main.js", text: generate(new Random(index + 1), kinds[index % kinds.length]) }),
  })),
);
