import defer * as later from "./later.mjs";
console.log("before");
later.value ? 1 : 2;
console.log("after");
