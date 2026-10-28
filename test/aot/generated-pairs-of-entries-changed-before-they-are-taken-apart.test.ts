import { changes, makers, textOf } from "./generated/pairs-of-entries-changed-before-they-are-taken-apart";
import { generated } from "./generated/run-generated";

const alwaysRun = new Set([
  "reverse",
  "reverse by call",
  "reverse of what at answers",
  "an iterator method of its own",
]);

generated(
  "pairs of entries that change before a pattern takes them apart",
  Object.keys(makers).flatMap(maker =>
    Object.keys(changes).map(change => ({
      name: `${maker}, ${change}`,
      isAlwaysRun: alwaysRun.has(change) && maker !== "Array.from of a Map",
      isOnlyCompiled: true as const,
      make: () => ({ file: "main.mjs", text: textOf(maker, change) }),
    })),
  ),
);
