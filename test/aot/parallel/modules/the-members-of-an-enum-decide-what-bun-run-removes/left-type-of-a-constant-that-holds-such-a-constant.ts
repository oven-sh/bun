// @ts-nocheck
enum E { A = 4 }
const a = E.A, b = a;
if (typeof b === "number") {} else { module.exports = 1; }
(globalThis as any).mode = (function (this: unknown) { return this === undefined ? "strict" : "sloppy"; })();
