// A fixed list of seeds of ../compiler-emitted-commonjs-reexports.ts, which describes the programs.
import { corners, generate } from "../compiler-emitted-commonjs-reexports";
import { Random } from "../random";
import { family } from "../family";

const present = corners.length * 24;
const lacking = corners.length * 4;
const wider = corners.length * 12;
const quiet = corners.length * 12;

/** Only one importer, behind `export *`, imports the name, which is behind getters as TypeScript emits them. */
const onlyThroughAStar = [127, 295, 316];
/** A getter as TypeScript emits it returns a variable of an ES module, and the variable changes. */
const variableOfAnESModule = [1001008];

/** Getters as TypeScript emits them return a name that the dependency lacks, and the name is imported by name. */
const getterOntoNothing = [505, 526, 568];

/** An unlisted getter returns a member of a JSON file, and the name is read from the namespace. */
const getterThatIsNotListedOverJSON = [21];

/** A getter returns `.default` of a CommonJS file without `__esModule`. */
const memberNamedDefault = [652];
/** The files are in a package without side effects, and an ES module is between the getters and the program. */
const behindGettersOfAQuietPackage = [883, 1030];
export default family(
  "compiler emitted commonjs reexports",
  [...Array(present + lacking + wider + quiet).keys(), ...variableOfAnESModule.map(seed => seed - 1)].map(index => {
    const corner = corners[index % corners.length];
    // In the last seeds of the row the last file lacks the name that the other files re-export.
    const lacks = index >= present && index < present + lacking;
    // After them mostly the default is imported, mostly without the `esModuleInterop` helpers.
    const isWider = index >= present + lacking && index < present + lacking + wider;
    // In the last ones the files are in packages with "sideEffects": false.
    const isQuiet = index >= present + lacking + wider && index < present + lacking + wider + quiet;
    const isErased = index % 3 === 2;
    return {
      name: `seed ${index + 1}, ${corner}${lacks ? ", the name is lacking" : ""}${isQuiet ? ", no side effects" : ""}${isErased ? ", types erased" : ""}.`,
      ...(isErased && { flags: ["--aot-erase-types"] }),
      make: () => generate(new Random(index + 1), corner, lacks, isWider, isQuiet),
    };
  }),
);
