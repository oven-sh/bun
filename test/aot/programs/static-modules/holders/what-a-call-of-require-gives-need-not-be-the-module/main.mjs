// A holder that is exported, and calls of `require` that another function may answer.
import { held } from "./holder.mjs";
require("./replaced.cjs");
require("./mapped.cjs");
require("./by-call.cjs");
console.log(Object.keys(held).join(), held.a);
