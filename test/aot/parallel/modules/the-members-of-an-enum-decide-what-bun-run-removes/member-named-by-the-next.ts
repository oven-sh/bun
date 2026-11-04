// @ts-nocheck
enum E { A = 4, B = A + 1 }
if (E.B) {} else { module.exports = 1; }
(globalThis as any).mode = (function (this: unknown) { return this === undefined ? "strict" : "sloppy"; })();
