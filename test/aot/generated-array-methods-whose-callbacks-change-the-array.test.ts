import { changes, places, program } from "./generated/array-methods-whose-callbacks-change-the-array";
import { generated } from "./generated/run-generated";

const alwaysRun =
  /^(shortens it|makes it much longer|empties it and fills it with strings|stores NaN|freezes it|shifts it)$/;

generated(
  "array methods whose callbacks change the array",
  Object.keys(changes).flatMap(change =>
    places.flatMap(place =>
      [true, false].map(isTypeScript => ({
        name: `the callback of the ${place} method ${change}, ${isTypeScript ? "TypeScript" : "JavaScript"}`,
        isAlwaysRun: alwaysRun.test(change),
        isOnlyCompiled: true as const,
        make: () => program(change, place, isTypeScript),
      })),
    ),
  ),
);
