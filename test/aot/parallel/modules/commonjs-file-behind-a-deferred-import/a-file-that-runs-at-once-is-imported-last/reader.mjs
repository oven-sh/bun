import defer * as later from "./later.mjs";
import "./runs-at-once.mjs";
console.log("reader.mjs runs");
console.log(later.value);
