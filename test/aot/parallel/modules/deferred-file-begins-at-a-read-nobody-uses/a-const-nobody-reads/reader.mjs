import defer * as later from "./later.mjs";
console.log("before");
const unread = later.value;
console.log("after");
