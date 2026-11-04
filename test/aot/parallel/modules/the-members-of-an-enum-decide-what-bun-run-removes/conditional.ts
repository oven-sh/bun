// @ts-nocheck
enum E { A = 4 }
const x = E.A ? 1 : (module.exports = 1);
(globalThis as any).mode = (function (this: unknown) { return this === undefined ? "strict" : "sloppy"; })();
