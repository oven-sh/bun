// @ts-nocheck
namespace N {
  export enum E { A = 4 }
  function f() { if (E.A) {} else { module.exports = 1; } }
}
(globalThis as any).mode = (function (this: unknown) { return this === undefined ? "strict" : "sloppy"; })();
