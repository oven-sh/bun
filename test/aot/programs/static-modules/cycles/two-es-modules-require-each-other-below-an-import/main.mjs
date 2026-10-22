// The same two modules, but first.mjs is loaded by an import: no require() has a placeholder for it, so second.mjs gets the namespace object of first.mjs, live, with dead zones.
import { fromSecond } from "./first.mjs";
console.log(fromSecond, require("./second.mjs").later());
