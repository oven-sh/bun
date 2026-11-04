// @ts-nocheck
enum E { A = 4 }
if (typeof [E.A][0] === "number") {} else { module.exports = 1; }
(globalThis as any).mode = (function (this: unknown) { return this === undefined ? "strict" : "sloppy"; })();
