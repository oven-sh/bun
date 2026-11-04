// @ts-nocheck
enum E { A = 1 }
try { if (!E.A) module.exports = 1; } catch {}
(globalThis as any).mode = (function (this: unknown) { return this === undefined ? "strict" : "sloppy"; })();
