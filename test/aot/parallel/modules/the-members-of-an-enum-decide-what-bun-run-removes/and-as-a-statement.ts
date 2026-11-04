// @ts-nocheck
enum E { Z, A = 4, S = "x", T = "" }
E.Z && (module.exports = 1);
(globalThis as any).mode = (function (this: unknown) { return this === undefined ? "strict" : "sloppy"; })();
