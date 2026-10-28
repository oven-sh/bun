// Fixed seeds of fuzz/literals-with-the-same-keys-and-values-of-other-kinds.ts: object literals in many places of one program that have the same keys and values of other kinds in each place:
// numbers, texts, `undefined`, fields that are missing, lists, other literals. Each is handed to `JSON.stringify`, `Object.keys`, a spread and twenty more, and what they answer is printed.
import { generate } from "./fuzz/literals-with-the-same-keys-and-values-of-other-kinds";
import { Random } from "./fuzz/random";
import { generated } from "./generated/run-generated";

generated(
  "literals with the same keys and values of other kinds",
  Array.from({ length: 120 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    // Every run takes the first twelve seeds; AOT_GENERATED=all takes all.
    isAlwaysRun: index < 12,
    isOnlyCompiled: true as const,
    make: () => ({ file: "main.js", text: generate(new Random(index + 1)) }),
  })),
);
