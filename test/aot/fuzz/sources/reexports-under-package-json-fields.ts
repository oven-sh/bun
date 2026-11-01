// A fixed list of seeds of ../reexports-under-package-json-fields.ts, which describes the programs.
import { corners, generate } from "../reexports-under-package-json-fields";
import { Random } from "../random";
import { family } from "../family";

/**
 * A package without side effects re-exports the name through a CommonJS getter, and an ES module is between it and the
 * program.
 */
const behindAGetterOfAQuietPackage = [152, 297, 438];
/**
 * A CommonJS file without `__esModule` has a getter named `default`, and the default is imported through `export {
 * default } from` or read from the namespace.
 */
const defaultOfAFileWithoutTheMark = [50, 69, 220, 384, 490];
/** The name is behind two `export *` over CommonJS files, and an intermediate file re-exports it. */
const exportedAgainBehindTwoStars = [8, 81, 84, 101, 222, 313, 318, 454, 501, 621, 692, 790];
const earlier = corners.length * 20;
const wider = corners.length * 10;

export default family(
  "reexports under package json fields",
  Array.from({ length: earlier + wider }, (_, index) => {
    const corner = corners[index % corners.length];
    // In the last seeds the last file may hide its names, the second file may also have the name or come first, and the
    // `export *` helper may come from tslib.
    const isWider = index >= earlier;
    // The number of corners is a multiple of three, so the offset shifts by one with every row.
    const isErased = (index + Math.floor(index / corners.length)) % 3 === 2;
    const isJudgedAsAnExecutable =
      corner === '"module" beside "main"' && Math.floor(index / corners.length) % 2 === 1 && !isWider;
    return {
      name: `seed ${index + 1}, ${corner}${isJudgedAsAnExecutable ? ", as in an executable" : ""}${isErased ? ", types erased" : ""}.`,
      ...(isErased && { flags: ["--aot-erase-types"] }),
      ...(isJudgedAsAnExecutable && { referenceIsCompiled: true as const }),
      make: () => generate(new Random(index + 1), corner, isJudgedAsAnExecutable, isWider),
    };
  }),
);
