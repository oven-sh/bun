// Fixed seeds of fuzz/names-handed-on-by-commonjs-files-as-compilers-emit-them.ts: a name reaches its importers through one to three CommonJS files as TypeScript, Babel, swc and esbuild emit them or as they are
// written by hand (getters onto the file below, `__exportStar`, `__createBinding`, `__importStar`, `__importDefault` and their like, `Object.assign`, stores, `module.exports = require(..)`) and through ES modules that
// export it again, in the project or in packages, with declaration files that say what the name is, something else or something invalid, or with none. One or two files import it, by name, as the namespace or as the
// default, with and without a cycle. TypeScript accepts every program, so every build succeeds, and the executable prints what plain Bun prints and ends as it ends. Every third program is built with its types erased.
import { corners, generate } from "../names-handed-on-by-commonjs-files-as-compilers-emit-them";
import { Random } from "../random";
import { family } from "../family";

const present = corners.length * 24;
const lacking = corners.length * 4;
const wider = corners.length * 12;
const quiet = corners.length * 12;

/** Nobody but one importer behind `export *` takes the name, which lies behind getters as TypeScript emits them. */
const onlyThroughAStar = [127, 295, 316];
/** A getter as TypeScript emits it returns a variable of an ES module, and the variable changes. */
const variableOfAnESModule = [1001008];

/** Getters as TypeScript emits them return a name that the file below lacks, and the name is imported by name. */
const getterOntoNothing = [505, 526, 568];

/** A getter that is not listed returns a member of a JSON file, and the name is read on the namespace. */
const getterThatIsNotListedOverJSON = [21];

/** A getter returns `.default` of a CommonJS file without `__esModule`. */
const memberNamedDefault = [652];
/** The files lie in a package without side effects, and an ES module stands between the getters and the program. */
const behindGettersOfAQuietPackage = [883, 1030];
export default family(
  "names handed on by CommonJS files as compilers emit them",
  [...Array(present + lacking + wider + quiet).keys(), ...variableOfAnESModule.map(seed => seed - 1)].map(index => {
    const corner = corners[index % corners.length];
    // In the last seeds of the row the file at the end lacks the name that the files above it hand on.
    const lacks = index >= present && index < present + lacking;
    // Behind them mostly the default is taken, mostly without the helpers of `esModuleInterop`.
    const isWider = index >= present + lacking && index < present + lacking + wider;
    // In the last ones the files lie in packages that say "sideEffects": false.
    const isQuiet = index >= present + lacking + wider && index < present + lacking + wider + quiet;
    const isErased = index % 3 === 2;
    return {
      name: `seed ${index + 1}, ${corner}${lacks ? ", the name is lacking" : ""}${isQuiet ? ", no side effects" : ""}${isErased ? ", types erased" : ""}.`,
      ...(isErased && { flags: ["--aot-erase-types"] }),
      make: () => generate(new Random(index + 1), corner, lacks, isWider, isQuiet),
    };
  }),
);
