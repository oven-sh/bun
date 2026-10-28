import { generated } from "./generated/run-generated";
import { programs } from "./generated/values-that-enter-a-suspended-body";

// In every run: an async generator yields promises that are fulfilled and rejected inside a try with a finally, beside each way out of the try, and uses what the yield answers,
// in a build that checks while it runs what the compiler took for proven.
const inEveryRun =
  /^async generator, yield, (condition of an integer|sum of a fraction), driven by (next|return of a rejection), (try and an empty finally|two finallys|try catch finally)$/;

generated(
  "a value enters a suspended body",
  programs().map(({ name, file, text }, index) => ({
    name,
    isAlwaysRun: inEveryRun.test(name),
    isOnlyCompiled: true as const,
    flags: inEveryRun.test(name) || index % 2 === 0 ? ["--aot-validate"] : [],
    make: () => ({ file, text: text() }),
  })),
);
