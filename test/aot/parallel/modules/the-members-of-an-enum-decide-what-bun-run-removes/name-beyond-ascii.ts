// @ts-nocheck
enum E { é = 4 }
if (E.é) {} else { module.exports = 1; }
(globalThis as any).mode = (function (this: unknown) { return this === undefined ? "strict" : "sloppy"; })();
