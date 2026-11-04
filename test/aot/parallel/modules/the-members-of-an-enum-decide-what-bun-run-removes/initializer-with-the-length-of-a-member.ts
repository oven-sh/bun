// @ts-nocheck
enum E { A = "a", B = A.length }
if (E.B) {} else { module.exports = 1; }
(globalThis as any).mode = (function (this: unknown) { return this === undefined ? "strict" : "sloppy"; })();
