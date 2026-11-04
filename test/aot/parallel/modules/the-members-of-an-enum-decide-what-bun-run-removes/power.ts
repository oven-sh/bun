// @ts-nocheck
enum E { A = 2 ** 3 }
if (E.A === 8) {} else { module.exports = 1; }
(globalThis as any).mode = (function (this: unknown) { return this === undefined ? "strict" : "sloppy"; })();
