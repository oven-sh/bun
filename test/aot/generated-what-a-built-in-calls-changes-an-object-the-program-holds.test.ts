// Fixed seeds of fuzz/what-a-built-in-calls-changes-an-object-the-program-holds.ts: a built-in calls something of the program's through a protocol (a species, a well-known symbol, `then`, `toJSON`,
// `valueOf`, a comparator, a reviver, a mapper, a getter, a trap), and that adds to, stores into or deletes from an object the program already holds, which is then read in every way.
import { Random } from "./fuzz/random";
import { generate } from "./fuzz/what-a-built-in-calls-changes-an-object-the-program-holds";
import { generated } from "./generated/run-generated";

// Every run takes these, whatever else it takes.
const onceWrong = [13];

generated(
  "what a built-in calls changes an object the program holds",
  Array.from({ length: 120 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    // Every run takes the first twelve seeds; AOT_GENERATED=all takes all.
    isAlwaysRun: index < 12,
    wasOnceWrong: onceWrong.includes(index + 1),
    isOnlyCompiled: true as const,
    make: () => ({ file: "main.js", text: generate(new Random(index + 1)) }),
  })),
);
