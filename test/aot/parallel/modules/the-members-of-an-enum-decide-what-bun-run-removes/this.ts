// @ts-nocheck
enum E { A = 0 }
if (E.A) { this.x = 1; }
(globalThis as any).mode = (function (this: unknown) { return this === undefined ? "strict" : "sloppy"; })();
