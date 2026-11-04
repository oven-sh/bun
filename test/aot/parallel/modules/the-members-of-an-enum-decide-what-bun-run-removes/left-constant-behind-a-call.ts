// @ts-nocheck
enum E { A = 4 }
f();
const a = E.A;
if (a) {} else { module.exports = 1; }
function f() {}
(globalThis as any).mode = (function (this: unknown) { return this === undefined ? "strict" : "sloppy"; })();
