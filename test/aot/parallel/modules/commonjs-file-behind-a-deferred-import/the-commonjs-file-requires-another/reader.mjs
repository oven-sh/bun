import defer * as later from "./later.mjs";
console.log("reader.mjs runs", typeof later);
console.log(later.value);
