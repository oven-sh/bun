import defer * as later from "./later.mjs";
console.log("before");
later.value;
console.log("between");
console.log(later.value);
console.log("after");
