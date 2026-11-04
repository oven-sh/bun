// @ts-nocheck
enum E { A = 7 % 4, B = 7 / 2, C = 7 >>> 1, D = 7 ^ 2, F = 7 & 2 }
if (E.A === 3 && E.B === 3.5 && E.C === 3 && E.D === 5 && E.F === 2) {} else { module.exports = 1; }
(globalThis as any).mode = (function (this: unknown) { return this === undefined ? "strict" : "sloppy"; })();
