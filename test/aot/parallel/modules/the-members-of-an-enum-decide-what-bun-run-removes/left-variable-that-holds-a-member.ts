// @ts-nocheck
enum E { A = 4 }
let a = E.A;
if (a) {} else { module.exports = 1; }
(globalThis as any).mode = (function (this: unknown) { return this === undefined ? "strict" : "sloppy"; })();
