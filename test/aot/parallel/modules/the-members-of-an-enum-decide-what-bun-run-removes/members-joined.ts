// @ts-nocheck
enum F { B = 1, C = B << 2, D = C | B }
if (F.D === 5) {} else { module.exports = 1; }
(globalThis as any).mode = (function (this: unknown) { return this === undefined ? "strict" : "sloppy"; })();
