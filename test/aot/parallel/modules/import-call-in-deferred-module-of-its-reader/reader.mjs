import defer * as deferred from "./deferred.mjs";
console.log("reader begins");
export const loaded = deferred.loaded;
console.log("reader goes on");
