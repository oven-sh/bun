export const log = [];
await using r = { async [Symbol.asyncDispose]() { log.push("dispose " + a); await null; log.push("disposed"); } };
export const a = 1;
const x = import.meta.require("./x.cjs");
log.push("end " + x.v);
