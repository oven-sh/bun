// Fixed seeds of fuzz/names-handed-on-by-files-that-are-read-while-they-load.ts: the program takes a name through a file that hands it on, by a getter over a variable that is declared ahead of it or behind it, by
// a store, by a helper for `export *` or as an ES module; the file below asks for a file above itself while all of them are still being loaded, reads there what it can, and reads it again when everything is
// loaded. TypeScript accepts every program, so every build succeeds, and the executable prints what plain Bun prints and ends as it ends. Every third program is built with its types erased.
import { corners, generate } from "./fuzz/names-handed-on-by-files-that-are-read-while-they-load";
import { Random } from "./fuzz/random";
import { generated } from "./generated/run-generated";

/** A getter returns the whole of the file below out of a `const` that is declared behind it, and it is read while that file is still being loaded. */
const constBehindItsGetter = [7, 169, 304, 493];

generated(
  "names handed on by files that are read while they load",
  Array.from({ length: corners.length * 20 }, (_, index) => {
    const corner = corners[index % corners.length];
    // The corners are a multiple of three, so the turn moves on by one with every row of them.
    const isErased = (index + Math.floor(index / corners.length)) % 3 === 2;
    return {
      name: `seed ${index + 1}, ${corner}${isErased ? ", types erased" : ""}.`,
      // Every run takes one seed of each corner; AOT_GENERATED=all takes all.
      isAlwaysRun: index < corners.length,
      isOnlyCompiled: true as const,
      // Nothing is put into the text: one more importer of the name would be one more road to it.
      keepsItsText: true as const,
      // Where a name is not there when the modules are linked, plain Bun ends with 1.
      exitsAsPlainBunDoes: true as const,
      ...(isErased && { flags: ["--aot-erase-types"] }),
      ...(constBehindItsGetter.includes(index + 1) && { wasOnceWrong: true }),
      make: () => generate(new Random(index + 1), corner),
    };
  }),
);
