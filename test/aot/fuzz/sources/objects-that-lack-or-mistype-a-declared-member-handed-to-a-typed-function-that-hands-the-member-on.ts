// fuzz/objects-that-lack-or-mistype-a-declared-member-handed-to-a-typed-function-that-hands-the-member-on.ts: very small TypeScript programs in which an object
// that lacks a member of its declared type, or holds another kind of value in it, reaches a typed function that hands the member on without looking at it.
import { generate } from "../objects-that-lack-or-mistype-a-declared-member-handed-to-a-typed-function-that-hands-the-member-on";
import { Random } from "../random";
import { endless } from "../family";

export default endless(
  "objects that lack or mistype a declared member handed to a typed function that hands the member on",
  index => ({
    name: `seed ${index + 1}.`,
    // Every fourth is built so that it checks what the compiler took for granted.
    flags: index % 4 === 2 ? ["--aot-validate"] : [],
    make: () => generate(new Random(index + 1)),
  }),
);
