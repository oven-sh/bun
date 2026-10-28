// Fixed seeds of fuzz/descriptors-on-exports-that-define-property-refuses-or-reads-otherwise-than-they-look.ts: small programs in which a CommonJS file defines names on its exports with descriptors that look
// nearly like the ones compilers emit, many of which the language refuses, and another file requires or imports the names.
import { generate } from "./fuzz/descriptors-on-exports-that-define-property-refuses-or-reads-otherwise-than-they-look";
import { Random } from "./fuzz/random";
import { generated } from "./generated/run-generated";

const onceWrong = [12, 31, 58, 85, 118, 128, 157, 210, 214];

generated(
  "descriptors on exports that defineProperty refuses or reads otherwise than they look",
  Array.from({ length: 240 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    // Every run takes the first twenty-four seeds; AOT_GENERATED=all takes all.
    isAlwaysRun: index < 24,
    wasOnceWrong: onceWrong.includes(index + 1),
    isOnlyCompiled: true as const,
    // A refusal that nobody catches ends the program.
    exitsAsPlainBunDoes: true as const,
    // Nothing is put into the text: how a definition is written is the point.
    keepsItsText: true as const,
    // Every fourth is built so that it checks what the compiler took for granted.
    flags: index % 4 === 2 ? ["--aot-validate"] : [],
    make: () => generate(new Random(index + 1)),
  })),
);
