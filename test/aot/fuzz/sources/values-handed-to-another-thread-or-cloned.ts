// Fixed seeds of fuzz/values-handed-to-another-thread-or-cloned.ts: one value is handed over on a road that copies or moves it (`workerData`, messages to and from workers, channels, ports that are handed on,
// broadcasts, `structuredClone`, environment data, serializers, what a worker throws) and is read at the far end, by JavaScript or by TypeScript. Every value that can be copied meets every road.
// TypeScript accepts every program, so every build succeeds, and the executable prints what plain Bun prints and ends as it ends. Every third program is built with its types erased.
import { Random } from "../random";
import { corners, generate } from "../values-handed-to-another-thread-or-cloned";
import { family } from "../family";

/** Built without --aot-validate today. */
const notValidatedToday = [418, 461, 579, 617, 665, 925, 983, 1003];

export default family(
  "values handed to another thread or cloned",
  corners.map((corner, index) => {
    const isErased = index % 3 === 2;
    return {
      name: `seed ${index + 1}, ${corner}${isErased ? ", types erased" : ""}.`,
      ...(isErased && { flags: ["--aot-erase-types"] }),
      ...(notValidatedToday.includes(index + 1) && {}),
      make: () => generate(new Random(index + 1), corner),
    };
  }),
);
