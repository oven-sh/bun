// Fixed seeds of fuzz/a-member-between-the-two-halves-of-an-accessor-stores-what-they-read.ts: small programs in which the getter and the setter of one name stand apart in a literal or a class, and
// a member between them stores to a variable that the halves read.
import { generate } from "../../fuzz/a-member-between-the-two-halves-of-an-accessor-stores-what-they-read";
import { Random } from "../../fuzz/random";
import { generated } from "../../generated/run-generated";

const onceWrong = [40, 49, 194, 204, 206, 223];

generated(
  "a member between the two halves of an accessor stores what they read",
  Array.from({ length: 240 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    // Every run takes the first twenty-four seeds; AOT_GENERATED=all takes all.
    isAlwaysRun: index < 24,
    wasOnceWrong: onceWrong.includes(index + 1),
    isOnlyCompiled: true as const,
    // Nothing is put into the text: the order in which the members are written is the point.
    keepsItsText: true as const,
    // Every fourth is built so that it checks what the compiler took for granted.
    flags: index % 4 === 2 ? ["--aot-validate"] : [],
    make: () => generate(new Random(index + 1)),
  })),
);
