// @ts-nocheck
enum E { A = 0 }
E.A && exports;
(globalThis as any).mode = (function (this: unknown) { return this === undefined ? "strict" : "sloppy"; })();
