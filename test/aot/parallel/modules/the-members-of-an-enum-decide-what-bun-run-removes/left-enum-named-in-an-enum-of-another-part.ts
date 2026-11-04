// @ts-nocheck
namespace N { export enum E { A = 4 } }
namespace N { export enum F { B = E.A } }
if (N.F.B) {} else { module.exports = 1; }
(globalThis as any).mode = (function (this: unknown) { return this === undefined ? "strict" : "sloppy"; })();
