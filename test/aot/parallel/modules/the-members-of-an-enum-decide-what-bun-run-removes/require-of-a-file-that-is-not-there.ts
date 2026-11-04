// @ts-nocheck
enum E { A = 0 }
if (E.A) { require("./nothing"); }
(globalThis as any).mode = (function (this: unknown) { return this === undefined ? "strict" : "sloppy"; })();
