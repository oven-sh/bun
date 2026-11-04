// @ts-nocheck
enum F { B = F.B }
if (F.B) { module.exports = 1; }
(globalThis as any).mode = (function (this: unknown) { return this === undefined ? "strict" : "sloppy"; })();
