// fuzz/descriptors-on-exports-that-define-property-refuses-or-reads-otherwise-than-they-look.ts: small programs in which a CommonJS file defines names on its exports with descriptors that look
// nearly like the ones compilers emit, many of which the language refuses, and another file requires or imports the names.
import { generate } from "../descriptors-on-exports-that-define-property-refuses-or-reads-otherwise-than-they-look";
import { Random } from "../random";
import { endless } from "../family";

export default endless(
  "descriptors on exports that defineProperty refuses or reads otherwise than they look",
  index => ({
    name: `seed ${index + 1}.`,
    // Every fourth is built so that it checks what the compiler took for granted.
    flags: index % 4 === 2 ? ["--aot-validate"] : [],
    make: () => generate(new Random(index + 1)),
  }),
);
