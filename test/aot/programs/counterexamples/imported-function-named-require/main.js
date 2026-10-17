// An imported function that is named `require` is called like any other function.
import { require } from "./mine.mjs";
console.log(require("./lib.cjs").a);
