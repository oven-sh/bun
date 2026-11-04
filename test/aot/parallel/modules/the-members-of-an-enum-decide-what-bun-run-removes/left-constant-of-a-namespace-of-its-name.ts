// @ts-nocheck
enum E { A = 4 }
namespace E { export const B = 0; }
if (E.B) { module.exports = 1; }
(globalThis as any).mode = (function (this: unknown) { return this === undefined ? "strict" : "sloppy"; })();
