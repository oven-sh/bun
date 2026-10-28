// Fixed seeds of fuzz/functions-handed-to-async-functions-and-used-around-their-awaits.ts: a caller hands a closure or a bound function over its
// own locals to an async function, which calls, keeps, stores, captures, passes on or returns it before and behind its awaits. The caller returns
// first, the stack is written over and a collection runs before the async function goes on.
import { generate } from "./fuzz/functions-handed-to-async-functions-and-used-around-their-awaits";
import { Random } from "./fuzz/random";
import { generated } from "./generated/run-generated";

generated(
  "functions handed to async functions work around their awaits as in plain Bun",
  Array.from({ length: 240 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    // Every run takes the first sixteen seeds; AOT_GENERATED=all takes all.
    isAlwaysRun: index < 16,
    isOnlyCompiled: true as const,
    flags:
      index % 4 === 3 ? ["--aot-heat=everything-is-hot"] : index % 4 === 2 ? ["--aot-heat=everything-is-cold"] : [],
    make: () => ({ file: "main.js", text: generate(new Random(index + 1)) }),
  })),
);
