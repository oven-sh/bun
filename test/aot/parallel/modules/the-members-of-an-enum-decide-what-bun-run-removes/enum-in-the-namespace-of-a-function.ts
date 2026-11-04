// @ts-nocheck
function f() {}
namespace f { export enum E { A = 4 } }
if (f.E.A) {} else { module.exports = 1; }
(globalThis as any).mode = (function (this: unknown) { return this === undefined ? "strict" : "sloppy"; })();
