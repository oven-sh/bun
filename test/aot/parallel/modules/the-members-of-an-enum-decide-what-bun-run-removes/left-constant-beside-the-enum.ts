// @ts-nocheck
const one = 1;
enum F { B = one }
if (F.B) {} else { module.exports = 1; }
(globalThis as any).mode = (function (this: unknown) { return this === undefined ? "strict" : "sloppy"; })();
