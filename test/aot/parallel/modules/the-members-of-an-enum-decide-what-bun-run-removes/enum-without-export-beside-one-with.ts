// @ts-nocheck
namespace N { enum E { A = 4 } }
namespace N { export enum E { B = 5 } }
if (N.E.B) {} else { module.exports = 1; }
(globalThis as any).mode = (function (this: unknown) { return this === undefined ? "strict" : "sloppy"; })();
