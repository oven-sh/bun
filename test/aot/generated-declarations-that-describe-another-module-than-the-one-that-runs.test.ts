// Fixed seeds of fuzz/declarations-that-describe-another-module-than-the-one-that-runs.ts: small programs in which TypeScript imports a module of JavaScript whose declarations describe it rightly, wrongly, in part
// or as another version of it was: literal types, constants that change, other names and parameters, a class for a function, `value is T`, `asserts`, `never`, overloads, generic functions, enums, promises, the
// fields of a class, `export =`, augmentations. The declarations lie beside the file, in a package, under @types or in a `declare module`, some with invalid declarations beside them under `skipLibCheck`.
// TypeScript accepts every program, so every build succeeds, and the executable prints what plain Bun prints and ends as it ends. Every third program is built with its types erased.
import { generate, said } from "./fuzz/declarations-that-describe-another-module-than-the-one-that-runs";
import { Random } from "./fuzz/random";
import { generated } from "./generated/run-generated";

generated(
  "declarations that describe another module than the one that runs",
  Array.from({ length: said.length * 16 }, (_, index) => {
    const what = said[index % said.length];
    const isErased = index % 3 === 2;
    return {
      name: `seed ${index + 1}, ${what}${isErased ? ", types erased" : ""}.`,
      // Every run takes one program for each thing that is said; AOT_GENERATED=all takes all.
      isAlwaysRun: index < said.length,
      isOnlyCompiled: true as const,
      // Nothing is put into the text: one more use of the module would tell the compiler more about it.
      keepsItsText: true as const,
      // Where nothing catches what an operation throws for what the module really exports, plain Bun ends with 1.
      exitsAsPlainBunDoes: true as const,
      ...(isErased && { flags: ["--aot-erase-types"] }),
      make: () => generate(new Random(index + 1), what),
    };
  }),
);
