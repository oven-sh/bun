// @ts-nocheck
enum E { A = 4 }
switch (E.A) { case 5: module.exports = 1; }
(globalThis as any).mode = (function (this: unknown) { return this === undefined ? "strict" : "sloppy"; })();
