// @ts-nocheck
enum E { Z, A = 4, S = "x", T = "" }
if (E.S + "y" === "xy") {} else { module.exports = 1; }
(globalThis as any).mode = (function (this: unknown) { return this === undefined ? "strict" : "sloppy"; })();
