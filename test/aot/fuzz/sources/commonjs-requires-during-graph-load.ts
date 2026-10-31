// A list of programs from ../generators/commonjs-requires-during-graph-load.ts, which describes them.
import { family } from "../family";
import {
  asked,
  type Case,
  cases,
  loaders,
  make,
  nameOf,
  places,
  watchers,
} from "../generators/commonjs-requires-during-graph-load";

// Plain Bun transpiles on one thread here, so files are read in request order. Without the variable it reads them on
// several threads and a file that `import()` asks for runs in a later turn, as it does in an executable.
const plainEnv = { BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER: "1" };
const unstablePlainOutput = "as plain Bun where it reads files on several threads";

const numberIn = (list: object, name: string) => Object.keys(list).indexOf(name);

export default family(
  "commonjs requires during graph load",
  cases.map(given => ({
    name: nameOf(given),
    plainEnv,
    unstablePlainOutput,
    make: () => make(given),
  })),
);
