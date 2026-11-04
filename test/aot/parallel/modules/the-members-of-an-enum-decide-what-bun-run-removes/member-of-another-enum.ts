// @ts-nocheck
enum E { Z, A = 4, S = "x", T = "" }
enum F { B = E.A, C, D = E.S }
if (F.C === 5 && F.D === "x") {} else { module.exports = 1; }
(globalThis as any).mode = (function (this: unknown) { return this === undefined ? "strict" : "sloppy"; })();
