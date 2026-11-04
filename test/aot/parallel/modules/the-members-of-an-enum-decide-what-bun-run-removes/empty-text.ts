// @ts-nocheck
enum E { A = "" }
if (E.A) { module.exports = 1; }
(globalThis as any).mode = (function (this: unknown) { return this === undefined ? "strict" : "sloppy"; })();
