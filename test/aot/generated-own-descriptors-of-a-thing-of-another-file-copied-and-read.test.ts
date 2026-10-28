// Fixed seeds of fuzz/own-descriptors-of-a-thing-of-another-file-copied-and-read.ts: one file exports a function, a class, a list or another thing, another file copies its own properties by their descriptors onto
// another object (`Object.defineProperties` with `Object.getOwnPropertyDescriptors`, `Object.create`, a loop over the keys ..), and the program reads the copy by name and key by key. Every thing meets every way to copy.
// TypeScript accepts every program, so every build succeeds, and the executable prints what plain Bun prints and ends as it ends. Every third program is built with its types erased.
import { corners, generate } from "./fuzz/own-descriptors-of-a-thing-of-another-file-copied-and-read";
import { Random } from "./fuzz/random";
import { generated } from "./generated/run-generated";

const onceWrong = [10, 14, 125, 144, 169, 598, 631, 701, 780, 897, 916, 942];

/** Built without --aot-validate today. */
const notValidatedToday = [
  112, 743, 746, 752, 755, 756, 757, 760, 761, 762, 770, 771, 911, 914, 924, 981, 984, 986, 989, 990, 991, 993, 994,
];

generated(
  "own descriptors of a thing of another file, copied and read",
  corners.map((corner, index) => {
    const isErased = index % 3 === 2;
    return {
      name: `seed ${index + 1}, ${corner}${isErased ? ", types erased" : ""}.`,
      // Every run takes one program in thirteen, so that each thing and each way come up; AOT_GENERATED=all takes all.
      isAlwaysRun: index % 13 === 0,
      isOnlyCompiled: true as const,
      keepsItsText: true as const,
      exitsAsPlainBunDoes: true as const,
      ...(isErased && { flags: ["--aot-erase-types"] }),
      ...(onceWrong.includes(index + 1) && { wasOnceWrong: true }),
      ...(notValidatedToday.includes(index + 1) && { isNeverValidated: true as const }),
      make: () => generate(new Random(index + 1), corner),
    };
  }),
);
