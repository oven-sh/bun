// @ts-nocheck
enum E { Z, A = 4, S = "x", T = "" }
const a = E.A;
if (a) {} else { module.exports = 1; }
(globalThis as any).mode = (function (this: unknown) { return this === undefined ? "strict" : "sloppy"; })();
