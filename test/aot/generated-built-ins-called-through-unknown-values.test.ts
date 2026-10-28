import { cases, textOf, ways } from "./generated/built-ins-called-through-unknown-values";
import { generated } from "./generated/run-generated";

// The ways in which the compiler first sees the built-in and then loses sight of it. The others are drawn now and then.
const inEveryRun = new Set([
  "by its name where built-ins may have been replaced",
  "out of a parsed array",
  "with its operands out of a parsed array",
  "either by its name or out of a parsed array",
]);
const inspector = "Bun.inspect runs the custom inspector of a class";

generated(
  "a built-in does the same however it is reached",
  cases.flatMap(one =>
    Object.entries(ways)
      .filter(([, way]) => way.fits?.(one) ?? true)
      .map(([how, way]) => ({
        name: `${one.name}, ${how}`,
        isAlwaysRun: inEveryRun.has(how),
        wasOnceWrong: one.name === inspector && !how.startsWith("by its name"),
        isOnlyCompiled: true as const,
        make: () => ({ file: "main.mjs", text: textOf(one, way) }),
      })),
  ),
);
