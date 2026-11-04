// @ts-nocheck
namespace N { export enum F { B = 1 } }
namespace N { export const c = F.B; }
if (N.F.B) {} else { module.exports = 1; }
(globalThis as any).mode = (function (this: unknown) { return this === undefined ? "strict" : "sloppy"; })();
