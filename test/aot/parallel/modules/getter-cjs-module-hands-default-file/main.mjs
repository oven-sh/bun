// An ES module hands on the default of a CommonJS file that has no `__esModule`, which is the whole exports of the file. A getter of a second CommonJS
// file returns that, for whoever imports the name and for whoever requires the file.
import whole from "./lib.cjs";
import { taken } from "./renamed.cjs";
import ofMarked from "./over-the-flag.cjs";
import { read } from "./reader.cjs";

console.log(JSON.stringify(whole), JSON.stringify(taken), JSON.stringify(ofMarked), JSON.stringify(read()));
