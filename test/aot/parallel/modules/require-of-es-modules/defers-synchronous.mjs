import defer * as deferred from "./deferred-synchronous/top.mjs";
console.log("defers-synchronous starts");
export const read = deferred.value;
console.log("defers-synchronous ends");
