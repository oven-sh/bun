// @ts-nocheck
enum E { A = 0.5, B }
if (E.B === 1.5) {} else { module.exports = 1; }
(globalThis as any).mode = (function (this: unknown) { return this === undefined ? "strict" : "sloppy"; })();
