import defer * as deferred from "./deferred-awaiting/top.mjs";
console.log("defers-awaiting starts");
export const read = deferred.value;
console.log("defers-awaiting ends");
