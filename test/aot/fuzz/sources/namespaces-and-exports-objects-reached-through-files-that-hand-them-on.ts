// Fixed seeds of fuzz/namespaces-and-exports-objects-reached-through-files-that-hand-them-on.ts: small programs of three to five files in which the first file reaches the namespace object or the
// `module.exports` of the last one only through files that hand it on, holds it in one way and asks a few things of it: members, keys, attributes, what may be done to it. Every line is printed at once.
import { generate } from "../namespaces-and-exports-objects-reached-through-files-that-hand-them-on";
import { Random } from "../random";
import { family } from "../family";

export default family(
  "namespaces and exports objects reached through files that hand them on",
  Array.from({ length: 240 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    // This program ends by an error that nobody catches.
    ...(index + 1 === 72 ? {} : {}),
    make: () => generate(new Random(index + 1)),
  })),
);
