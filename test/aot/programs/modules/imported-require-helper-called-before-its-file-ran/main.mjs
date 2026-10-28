// In a cycle of imports a file calls the `require` that another file exports before that file has filled the variable.
import "./chunk.mjs";
import { later } from "./runs-first.mjs";
console.log(later());
