// @ts-nocheck
enum E { A = 1 }
function f() { if (E.A) return; module.exports = 1; }
(globalThis as any).mode = (function (this: unknown) { return this === undefined ? "strict" : "sloppy"; })();
