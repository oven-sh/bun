// Fixed seeds of fuzz/a-member-between-the-two-halves-of-an-accessor-stores-what-they-read.ts: small programs in which the getter and the setter of one name stand apart in a literal or a class, and
// a member between them stores to a variable that the halves read.
import { generate } from "../a-member-between-the-two-halves-of-an-accessor-stores-what-they-read";
import { Random } from "../random";
import { family } from "../family";

export default family(
  "a member between the two halves of an accessor stores what they read",
  Array.from({ length: 240 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    // Every fourth is built so that it checks what the compiler took for granted.
    flags: index % 4 === 2 ? ["--aot-validate"] : [],
    make: () => generate(new Random(index + 1)),
  })),
);
