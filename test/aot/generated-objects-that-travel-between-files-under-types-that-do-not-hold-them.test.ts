// Fixed seeds of fuzz/objects-that-travel-between-files-under-types-that-do-not-hold-them.ts: small programs of three to six files about one object. The file that makes it keeps it and hands it to another file
// under a written type that does not hold it: a number, a text, `never`, another class. At the far end it is taken for what it is again and changed in one way. Then the file that made it reads it under the name it
// has there. TypeScript accepts every program, so every build succeeds, and the executable prints what plain Bun prints and ends as it ends. Every third program is built with its types erased.
import { generate } from "./fuzz/objects-that-travel-between-files-under-types-that-do-not-hold-them";
import { Random } from "./fuzz/random";
import { generated } from "./generated/run-generated";

generated(
  "objects that travel between files under types that do not hold them",
  Array.from({ length: 480 }, (_, index) => {
    const isErased = index % 3 === 2;
    return {
      name: `seed ${index + 1}${isErased ? ", types erased" : ""}.`,
      // Every run takes the first forty seeds; AOT_GENERATED=all takes all.
      isAlwaysRun: index < 40,
      isOnlyCompiled: true as const,
      // Nothing is put into the text: one more use of the object would tell the compiler more about it.
      keepsItsText: true as const,
      // Where nothing catches what a change or a read throws, plain Bun ends with 1.
      exitsAsPlainBunDoes: true as const,
      ...(isErased && { flags: ["--aot-erase-types"] }),
      make: () => generate(new Random(index + 1)),
    };
  }),
);
