// The barrel has a name of its own that a file it stars has too: nobody reads the other one, and its code is not in the program.
// Nothing else is read off the barrel: a name that only the run finds would bring all of its names into the program.
import * as barrel from "./barrel.mjs";
const show = value => (typeof value === "function" ? value() : value);
console.log(show(barrel.x));
