// @ts-nocheck
enum E { A = 1, B = (A, 5) }
if (E.B === 5) {} else { module.exports = 1; }
(globalThis as any).mode = (function (this: unknown) { return this === undefined ? "strict" : "sloppy"; })();
