// Fixed seeds of fuzz/members-named-like-a-constant-or-a-number-taken-out-of-namespaces-and-objects.ts: small programs in which an export or a member is named like a constant, a number
// or a built-in, is taken out of its namespace or object in every way there is, and is asked what it is.
import { generate } from "./fuzz/members-named-like-a-constant-or-a-number-taken-out-of-namespaces-and-objects";
import { Random } from "./fuzz/random";
import { generated } from "./generated/run-generated";

const onceWrong = [18, 22, 23, 54, 56, 59, 75, 80];

generated(
  "members named like a constant or a number taken out of namespaces and objects",
  Array.from({ length: 240 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    // Every run takes the first twenty-four seeds; AOT_GENERATED=all takes all.
    isAlwaysRun: index < 24,
    wasOnceWrong: onceWrong.includes(index + 1),
    isOnlyCompiled: true as const,
    // Nothing is put into the text: the names are the point, and what is put into a text uses some of them.
    keepsItsText: true as const,
    // Every fourth is built so that it checks what the compiler took for granted.
    flags: index % 4 === 2 ? ["--aot-validate"] : [],
    make: () => generate(new Random(index + 1)),
  })),
);
