import defer * as later from "./later.mjs";
console.log("before");
void later.value;
console.log("after");
