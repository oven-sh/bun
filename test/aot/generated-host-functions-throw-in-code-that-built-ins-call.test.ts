// Fixed seeds of fuzz/host-functions-throw-in-code-that-built-ins-call.ts: a function of the host or of the language throws inside a getter, a conversion, a callback, a trap, an iterator or a listener
// that a built-in function has called. The call that throws stands in tail position or not, and the exception is caught in that function, around the built-in function, one function further up or nowhere.
// Each scene prints who caught what, and in most programs the own properties and the frames of what was caught.
import { generate } from "./fuzz/host-functions-throw-in-code-that-built-ins-call";
import { Random } from "./fuzz/random";
import { generated } from "./generated/run-generated";

// Every run takes these, whatever else it takes.
const inEveryRun = [0, 1, 6, 7, 14, 15, 16, 17, 18, 19, 21, 24];

generated(
  "what a host function throws in code that a built-in function calls arrives as in plain Bun",
  Array.from({ length: 192 }, (_, index) => {
    const seed = (index >> 1) + 1;
    const leavesAnError = !!(index & 1);
    return {
      name: `seed ${seed}${leavesAnError ? ", and nobody catches the last." : "."}`,
      // AOT_GENERATED=all takes all.
      isAlwaysRun: index < 8,
      wasOnceWrong: inEveryRun.includes(index),
      isOnlyCompiled: true as const,
      ...(leavesAnError ? { exitsAsPlainBunDoes: true as const } : {}),
      flags: inEveryRun.includes(index)
        ? []
        : seed % 4 === 3
          ? ["--aot-heat=everything-is-hot"]
          : seed % 4 === 2
            ? ["--aot-heat=everything-is-cold"]
            : [],
      make: () => ({ file: "main.mjs", text: generate(new Random(seed), leavesAnError) }),
    };
  }),
);
