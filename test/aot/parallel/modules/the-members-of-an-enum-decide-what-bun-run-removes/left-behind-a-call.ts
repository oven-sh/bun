// @ts-nocheck
enum F { B = 1, C = f0(), D }
function f0() { return 1; }
if (F.D) {} else { module.exports = 1; }
(globalThis as any).mode = (function (this: unknown) { return this === undefined ? "strict" : "sloppy"; })();
