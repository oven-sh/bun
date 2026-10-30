// Fixed seeds of fuzz/what-stands-on-the-prototypes-when-an-instance-is-made-stored-to-and-read.ts: small programs about one instance and one change to an object above it: an accessor, a member that
// cannot be written, a proxy or another object comes, or something goes, ahead of the making, inside it, behind it or behind a store. A field defines its member; a store asks the objects above first.
import { Random } from "../random";
import { generate } from "../what-stands-on-the-prototypes-when-an-instance-is-made-stored-to-and-read";
import { family } from "../family";

export default family(
  "what stands on the prototypes when an instance is made, stored to and read",
  Array.from({ length: 240 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    make: () => ({
      file: index % 3 === 0 ? "main.cjs" : "main.mjs",
      text: generate(new Random(index + 1)),
    }),
  })),
);
