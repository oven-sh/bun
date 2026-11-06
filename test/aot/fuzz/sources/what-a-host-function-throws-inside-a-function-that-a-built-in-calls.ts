// Fixed seeds of fuzz/what-a-host-function-throws-inside-a-function-that-a-built-in-calls.ts: small programs about one call that throws, made inside a function of the program that a built-in calls (a
// getter, `valueOf`, `toJSON`, an iterator, a trap, a callback), and a handler round the built-in. What is thrown arrives at the handler as it would from a call written there.
import { Random } from "../random";
import { generate } from "../what-a-host-function-throws-inside-a-function-that-a-built-in-calls";
import { family } from "../family";

export default family(
  "what a host function throws inside a function that a built-in calls",
  Array.from({ length: 240 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    make: () => generate(new Random(index + 1)),
  })),
);
