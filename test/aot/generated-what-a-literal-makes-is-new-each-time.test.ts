// Fixed seeds of fuzz/what-a-literal-makes-is-new-each-time.ts: lists, objects, regular expressions, functions and classes written as literals, in functions that are called again and again.
// What one call's object is changed into does not show in the next call's. They print each object before and behind the changes, and the next one.
import { Random } from "./fuzz/random";
import { generate } from "./fuzz/what-a-literal-makes-is-new-each-time";
import { generated } from "./generated/run-generated";

generated(
  "what a literal makes is new each time",
  Array.from({ length: 120 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    // Every run takes the first twelve seeds; AOT_GENERATED=all takes all.
    isAlwaysRun: index < 12,
    isOnlyCompiled: true as const,
    make: () => ({ file: "main.js", text: generate(new Random(index + 1)) }),
  })),
);
