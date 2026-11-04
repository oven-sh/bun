// @ts-nocheck
namespace N { export namespace M { export enum E { A = 4 } } }
if (N.M.E.A) {} else { module.exports = 1; }
(globalThis as any).mode = (function (this: unknown) { return this === undefined ? "strict" : "sloppy"; })();
