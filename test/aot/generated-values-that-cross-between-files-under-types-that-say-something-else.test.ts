// Fixed seeds of fuzz/values-that-cross-between-files-under-types-that-say-something-else.ts: small programs of two to five files in which one value crosses from the file that makes it into a file that uses it,
// under a type that may say something else than what arrives: a declaration file beside JavaScript, one that is invalid itself under `skipLibCheck`, JSDoc, types inferred from JavaScript, a package, an ambient
// declaration, a cast or an ignored error in another file of TypeScript, a type that is invalid itself, JavaScript that calls into TypeScript. TypeScript accepts every program, so every build succeeds, and the executable prints what plain Bun
// prints and ends as it ends. Every third program is built with its types erased.
import { Random } from "./fuzz/random";
import { corners, generate } from "./fuzz/values-that-cross-between-files-under-types-that-say-something-else";
import { generated } from "./generated/run-generated";

/** Seeds in which a file of JavaScript imports JavaScript that has declarations, and TypeScript reads JavaScript (`allowJs`). */
const declarationsBehindJavaScript = [2000033, 2000136, 2000653, 2001049];

generated(
  "values that cross between files under types that say something else",
  [...Array(704).keys(), ...declarationsBehindJavaScript.map(seed => seed - 1)].map(index => {
    const corner = corners[index % corners.length];
    // From seed 485 on also `.cts` and `export * as` are drawn.
    const isWider = index >= 484 && index < 704;
    const isErased = index % 3 === 2;
    return {
      name: `seed ${index + 1}, ${corner}${isErased ? ", types erased" : ""}.`,
      // Every run takes the first forty-four seeds, four of each corner, and twenty-two of the later ones; AOT_GENERATED=all takes all.
      isAlwaysRun: index < 44 || (isWider && index < 506),
      isOnlyCompiled: true as const,
      // Nothing is put into the text: one more use of the value would tell the compiler more about it.
      keepsItsText: true as const,
      // Where nothing catches what an operation throws for the value that arrived, plain Bun ends with 1.
      exitsAsPlainBunDoes: true as const,
      ...(isErased && { flags: ["--aot-erase-types"] }),
      ...(index >= 704 && { wasOnceWrong: true }),
      make: () => generate(new Random(index + 1), corner, isWider),
    };
  }),
);
