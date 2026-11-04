// @ts-nocheck
enum E { A = 1, B = -A }
if (E.B === -1) {} else { module.exports = 1; }
(globalThis as any).mode = (function (this: unknown) { return this === undefined ? "strict" : "sloppy"; })();
