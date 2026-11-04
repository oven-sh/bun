// @ts-nocheck
enum E { A = 1 }
label: { if (E.A) break label; module.exports = 1; }
(globalThis as any).mode = (function (this: unknown) { return this === undefined ? "strict" : "sloppy"; })();
