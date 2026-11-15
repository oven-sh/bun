// A fixed list of seeds of ../mistyped-values-across-files.ts, which describes the programs.
import { Random } from "../random";
import { corners, generate } from "../mistyped-values-across-files";
import { family } from "../family";

/**
 * Seeds in which a JavaScript file imports JavaScript that has declarations, and TypeScript reads JavaScript
 * (`allowJs`).
 */
const declarationsBehindJavaScript = [2000033, 2000136, 2000653, 2001049];

export default family(
  "mistyped values across files",
  [...Array(704).keys(), ...declarationsBehindJavaScript.map(seed => seed - 1)].map(index => {
    const corner = corners[index % corners.length];
    // From seed 485 on `.cts` and `export * as` are also used.
    const isWider = index >= 484 && index < 704;
    const isErased = index % 3 === 2;
    return {
      name: `seed ${index + 1}, ${corner}${isErased ? ", types erased" : ""}.`,
      ...(isErased && { flags: ["--aot-erase-types"] }),
      make: () => generate(new Random(index + 1), corner, isWider),
    };
  }),
);
