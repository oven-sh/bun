// @ts-nocheck
enum E { S = "x" }
const a = E.S;
if (a) {} else { module.exports = 1; }
(globalThis as any).mode = (function (this: unknown) { return this === undefined ? "strict" : "sloppy"; })();
