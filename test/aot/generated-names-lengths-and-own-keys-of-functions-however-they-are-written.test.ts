// Fixed seeds of fuzz/names-lengths-and-own-keys-of-functions-however-they-are-written.ts: functions and classes of every kind, written in every place that gives a name or gives none.
// They print `name` and `length` with their attributes, the own keys in their order, what `prototype` holds, and the prototype of the function.
import { generate } from "./fuzz/names-lengths-and-own-keys-of-functions-however-they-are-written";
import { Random } from "./fuzz/random";
import { generated } from "./generated/run-generated";

generated(
  "names, lengths and own keys of functions however they are written",
  Array.from({ length: 120 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    // Every run takes the first twelve seeds; AOT_GENERATED=all takes all.
    isAlwaysRun: index < 12,
    isOnlyCompiled: true as const,
    make: () => ({ file: "main.js", text: generate(new Random(index + 1)) }),
  })),
);
