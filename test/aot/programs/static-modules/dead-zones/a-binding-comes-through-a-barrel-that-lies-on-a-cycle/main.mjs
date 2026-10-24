// reader.mjs lies on no cycle; the barrel that hands it `x` does, with early.mjs, which reads `x` through the barrel before its owner has run.
import { f } from "./reader.mjs";
console.log("main", f());
