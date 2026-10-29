import defer * as later from "./later.mjs";
console.log("before");
later.value ?? 0;
console.log("after");
