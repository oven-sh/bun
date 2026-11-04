// @ts-nocheck
enum F { B = C, C = 1 }
if (F.B) { module.exports = 1; }
(globalThis as any).mode = (function (this: unknown) { return this === undefined ? "strict" : "sloppy"; })();
