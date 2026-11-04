// @ts-nocheck
enum E { A = 4 }
const a = E.A + 1;
if (typeof a === "number") {} else { module.exports = 1; }
(globalThis as any).mode = (function (this: unknown) { return this === undefined ? "strict" : "sloppy"; })();
