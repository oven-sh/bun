// @ts-nocheck
enum E { A = 4 }
E.A && 0 || (module.exports = 1);
(globalThis as any).mode = (function (this: unknown) { return this === undefined ? "strict" : "sloppy"; })();
