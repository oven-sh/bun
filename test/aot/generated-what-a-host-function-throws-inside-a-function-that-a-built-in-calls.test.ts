// Fixed seeds of fuzz/what-a-host-function-throws-inside-a-function-that-a-built-in-calls.ts: small programs about one call that throws, made inside a function of the program that a built-in calls (a
// getter, `valueOf`, `toJSON`, an iterator, a trap, a callback), and a handler round the built-in. What is thrown arrives at the handler as it would from a call written there.
import { Random } from "./fuzz/random";
import { generate } from "./fuzz/what-a-host-function-throws-inside-a-function-that-a-built-in-calls";
import { generated } from "./generated/run-generated";

const onceWrong = [29, 55, 95, 149, 156, 160, 184, 216, 220, 239];

generated(
  "what a host function throws inside a function that a built-in calls",
  Array.from({ length: 240 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    // Every run takes the first twenty-four seeds; AOT_GENERATED=all takes all.
    isAlwaysRun: index < 24,
    wasOnceWrong: onceWrong.includes(index + 1),
    isOnlyCompiled: true as const,
    // Nothing is put into the text: the call that throws stands in one place alone.
    keepsItsText: true as const,
    make: () => generate(new Random(index + 1)),
  })),
);
