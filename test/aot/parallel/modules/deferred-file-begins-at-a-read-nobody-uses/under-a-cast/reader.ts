import defer * as later from "./later.ts";
console.log("before");
(later as { value: number }).value;
console.log("after");
