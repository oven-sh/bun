// Fixed seeds of fuzz/objects-that-lack-or-mistype-a-declared-member-handed-to-a-typed-function-that-hands-the-member-on.ts: very small TypeScript programs in which an object
// that lacks a member of its declared type, or holds another kind of value in it, reaches a typed function that hands the member on without looking at it.
import { generate } from "./fuzz/objects-that-lack-or-mistype-a-declared-member-handed-to-a-typed-function-that-hands-the-member-on";
import { Random } from "./fuzz/random";
import { generated } from "./generated/run-generated";

const onceWrong = [188];

generated(
  "objects that lack or mistype a declared member handed to a typed function that hands the member on",
  Array.from({ length: 240 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    // Every run takes the first twenty-four seeds; AOT_GENERATED=all takes all.
    isAlwaysRun: index < 24,
    wasOnceWrong: onceWrong.includes(index + 1),
    isOnlyCompiled: true as const,
    // Nothing is put into the text: the program is a few lines, and that nothing else stands in it is the point.
    keepsItsText: true as const,
    // Every fourth is built so that it checks what the compiler took for granted.
    flags: index % 4 === 2 ? ["--aot-validate"] : [],
    make: () => generate(new Random(index + 1)),
  })),
);
