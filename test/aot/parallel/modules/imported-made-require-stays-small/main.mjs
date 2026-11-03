// One file makes a `require` with createRequire and other files import it, as bundlers lay out a shared chunk. The paths are written, so the build knows each file that is loaded and the executable holds nothing that loads a file by a name made at run time.
// STATISTIC: ImageFunctionsEmitted <= 40
import { require } from "./lib/require.mjs";
import * as lib from "./lib/require.mjs";
console.log(require("./first.cjs"), lib.require("./second.cjs").value);
