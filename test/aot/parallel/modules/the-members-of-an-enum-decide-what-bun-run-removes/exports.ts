// @ts-nocheck
enum E { A = 0 }
if (E.A) { exports.x = 1; }
(globalThis as any).mode = (function (this: unknown) { return this === undefined ? "strict" : "sloppy"; })();
