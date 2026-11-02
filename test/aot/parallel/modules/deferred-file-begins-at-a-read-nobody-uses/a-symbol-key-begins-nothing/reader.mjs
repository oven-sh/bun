import defer * as later from "./later.mjs";
console.log("before");
later[Symbol.toStringTag];
console.log("after");
