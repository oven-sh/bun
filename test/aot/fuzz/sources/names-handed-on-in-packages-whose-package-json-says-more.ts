// Fixed seeds of fuzz/names-handed-on-in-packages-whose-package-json-says-more.ts: one name lies in the last file of a package and reaches the program through files of the package that hand it on, as compilers
// emit them, as they are written by hand or as ES modules, under a package.json that says one thing more than a name: "sideEffects", "main", "module", "browser", "type", "exports", "imports", each in several
// forms, a second package.json further down, the package.json of the project, a folder of the project that has one. The name is taken in one of many ways, straight or through ES modules, and is printed ahead of
// and behind a change in the last file. TypeScript accepts every program, so every build succeeds, and the executable prints what plain Bun prints and ends as it ends. Every third program is built with its
// types erased. Where package.json has "module" beside "main", an import takes another file in an executable than under `bun run`: half of those programs only require the package, and the other half is
// held against an executable that is built without --aot.
import { corners, generate } from "../names-handed-on-in-packages-whose-package-json-says-more";
import { Random } from "../random";
import { family } from "../family";

/** A package without side effects hands the name on by a getter of a CommonJS file, and an ES module stands between it and the program. */
const behindAGetterOfAQuietPackage = [152, 297, 438];
/** A CommonJS file without `__esModule` has a getter named `default`, and the default is taken through `export { default } from` or off the namespace. */
const defaultOfAFileWithoutTheMark = [50, 69, 220, 384, 490];
/** The name lies behind two `export *` over CommonJS files, and a file between exports it again. */
const exportedAgainBehindTwoStars = [8, 81, 84, 101, 222, 313, 318, 454, 501, 621, 692, 790];
const earlier = corners.length * 20;
const wider = corners.length * 10;

export default family(
  "names handed on in packages whose package.json says more",
  Array.from({ length: earlier + wider }, (_, index) => {
    const corner = corners[index % corners.length];
    // In the last seeds the text of the last file may hide its names, the second file may have the name too or come first, and the helper for `export *` may come from tslib.
    const isWider = index >= earlier;
    // The corners are a multiple of three, so the turn moves on by one with every row of them.
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
