import defer * as later from "./later.mjs";
console.log("before");
({ member: later.value });
console.log("after");
