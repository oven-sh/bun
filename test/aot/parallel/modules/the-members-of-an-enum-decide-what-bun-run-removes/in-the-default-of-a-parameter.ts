// @ts-nocheck
enum E { A = 1 }
function f(x = E.A ? 1 : module) {}
(globalThis as any).mode = (function (this: unknown) { return this === undefined ? "strict" : "sloppy"; })();
