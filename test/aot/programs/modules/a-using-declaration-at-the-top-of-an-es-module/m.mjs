export const log = [];
using r = { [Symbol.dispose]() { log.push("dispose " + a + " " + f()); } };
export const a = 1;
export function f() { return x.v; }
const x = import.meta.require("./x.cjs");
log.push("end");
