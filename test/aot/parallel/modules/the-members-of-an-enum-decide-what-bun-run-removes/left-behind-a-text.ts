// @ts-nocheck
enum F { B = "s", C }
if (F.C) { module.exports = 1; }
(globalThis as any).mode = (function (this: unknown) { return this === undefined ? "strict" : "sloppy"; })();
