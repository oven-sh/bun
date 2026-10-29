// Fixed seeds of fuzz/values-handed-to-another-thread-or-cloned.ts: one value is handed over on a road that copies or moves it (`workerData`, messages to and from workers, channels, ports that are handed on,
// broadcasts, `structuredClone`, environment data, serializers, what a worker throws) and is read at the far end, by JavaScript or by TypeScript. Every value that can be copied meets every road.
// TypeScript accepts every program, so every build succeeds, and the executable prints what plain Bun prints and ends as it ends. Every third program is built with its types erased.
import { Random } from "./fuzz/random";
import { corners, generate } from "./fuzz/values-handed-to-another-thread-or-cloned";
import { generated } from "./generated/run-generated";

const onceWrong = [2031];

/** Built without --aot-validate today. */
const notValidatedToday = [418, 461, 579, 617, 665, 925, 983, 1003];

generated(
  "values handed to another thread or cloned",
  corners.map((corner, index) => {
    const isErased = index % 3 === 2;
    return {
      name: `seed ${index + 1}, ${corner}${isErased ? ", types erased" : ""}.`,
      // Every run takes one program in seventeen, so that each value and each road come up; AOT_GENERATED=all takes all.
      isAlwaysRun: index % 17 === 0,
      isOnlyCompiled: true as const,
      // Each program is built alone and as it is written: its workers are entry points of its own.
      keepsItsText: true as const,
      exitsAsPlainBunDoes: true as const,
      ...(isErased && { flags: ["--aot-erase-types"] }),
      ...(onceWrong.includes(index + 1) && { wasOnceWrong: true }),
      ...(notValidatedToday.includes(index + 1) && { isNeverValidated: true as const }),
      make: () => generate(new Random(index + 1), corner),
    };
  }),
);
