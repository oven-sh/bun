// @ts-nocheck
enum E { A = 4 }
if (typeof (null ?? E.A) === "number") {} else { module.exports = 1; }
(globalThis as any).mode = (function (this: unknown) { return this === undefined ? "strict" : "sloppy"; })();
