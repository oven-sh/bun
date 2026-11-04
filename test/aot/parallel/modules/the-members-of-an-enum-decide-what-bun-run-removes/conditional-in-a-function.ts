// @ts-nocheck
enum E { Z, A = 4, S = "x", T = "" }
function g() { return E.A ? 1 : module.exports; }
(globalThis as any).mode = (function (this: unknown) { return this === undefined ? "strict" : "sloppy"; })();
