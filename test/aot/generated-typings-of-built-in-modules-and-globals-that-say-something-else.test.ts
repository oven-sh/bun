// Fixed seeds of fuzz/typings-of-built-in-modules-and-globals-that-say-something-else.ts: small programs that use one member of a built-in module or one global of Bun under typings that say something else about it
// than what it is: an @types/node of another version, a `declare module` or a declaration of the global in the project. TypeScript accepts every program, so every build succeeds. What runs is Bun's own member, and
// the executable prints what plain Bun prints and ends as it ends. Every third program is built with its types erased.
import { Random } from "./fuzz/random";
import { generate } from "./fuzz/typings-of-built-in-modules-and-globals-that-say-something-else";
import { generated } from "./generated/run-generated";

generated(
  "typings of built-in modules and globals that say something else",
  Array.from({ length: 360 }, (_, index) => {
    const isErased = index % 3 === 2;
    return {
      name: `seed ${index + 1}${isErased ? ", types erased" : ""}.`,
      // Every run takes the first thirty seeds; AOT_GENERATED=all takes all.
      isAlwaysRun: index < 30,
      isOnlyCompiled: true as const,
      // Nothing is put into the text: what a run puts there names globals that the program declares otherwise.
      keepsItsText: true as const,
      // Where nothing catches what an operation throws for what the member really is, plain Bun ends with 1.
      exitsAsPlainBunDoes: true as const,
      ...(isErased && { flags: ["--aot-erase-types"] }),
      make: () => generate(new Random(index + 1)),
    };
  }),
);
