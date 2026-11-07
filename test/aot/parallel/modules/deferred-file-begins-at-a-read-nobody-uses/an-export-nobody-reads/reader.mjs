import defer * as later from "./later.mjs";
console.log("before");
export const unread = later.value;
console.log("after");
