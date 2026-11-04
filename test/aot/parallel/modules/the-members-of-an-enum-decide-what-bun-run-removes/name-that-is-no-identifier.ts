// @ts-nocheck
enum E { "a-b" = 4 }
if (E["a-b"]) {} else { module.exports = 1; }
(globalThis as any).mode = (function (this: unknown) { return this === undefined ? "strict" : "sloppy"; })();
