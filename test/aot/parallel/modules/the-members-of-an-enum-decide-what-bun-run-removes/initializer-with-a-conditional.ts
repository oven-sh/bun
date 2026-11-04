// @ts-nocheck
enum E { A = 1, B = A ? 2 : 3 }
if (E.B === 2) {} else { module.exports = 1; }
(globalThis as any).mode = (function (this: unknown) { return this === undefined ? "strict" : "sloppy"; })();
