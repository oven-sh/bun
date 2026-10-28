// Fixed seeds of fuzz/namespaces-and-exports-objects-reached-through-files-that-hand-them-on.ts: small programs of three to five files in which the first file reaches the namespace object or the
// `module.exports` of the last one only through files that hand it on, holds it in one way and asks a few things of it: members, keys, attributes, what may be done to it. Every line is printed at once.
import { generate } from "../../fuzz/namespaces-and-exports-objects-reached-through-files-that-hand-them-on";
import { Random } from "../../fuzz/random";
import { generated } from "../../generated/run-generated";

const onceWrong = [
  6, 17, 18, 19, 37, 38, 41, 47, 52, 54, 71, 99, 104, 133, 140, 154, 174, 188, 194, 197, 206, 211, 215, 233, 236,
];

generated(
  "namespaces and exports objects reached through files that hand them on",
  Array.from({ length: 240 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    // Every run takes the first twenty-four seeds; AOT_GENERATED=all takes all.
    isAlwaysRun: index < 24,
    wasOnceWrong: onceWrong.includes(index + 1),
    isOnlyCompiled: true as const,
    // Nothing is put into the text: one more use of a file would be one more road to it.
    keepsItsText: true as const,
    // This program ends by an error that nobody catches.
    ...(index + 1 === 72 ? { exitsAsPlainBunDoes: true as const } : {}),
    make: () => generate(new Random(index + 1)),
  })),
);
