// @ts-nocheck
enum E { A = 1, B = true }
if (E.B) {} else { module.exports = 1; }
(globalThis as any).mode = (function (this: unknown) { return this === undefined ? "strict" : "sloppy"; })();
