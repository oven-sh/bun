// @ts-nocheck
enum E { A = 4 }
enum E { B = E.A + 1 }
if (E.B === 5) {} else { module.exports = 1; }
(globalThis as any).mode = (function (this: unknown) { return this === undefined ? "strict" : "sloppy"; })();
