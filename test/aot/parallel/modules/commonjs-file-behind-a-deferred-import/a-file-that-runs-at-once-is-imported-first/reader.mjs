import "./at-once.mjs";
import defer * as later from "./later.mjs";
console.log("reader.mjs runs");
console.log(later.value);
