// @ts-nocheck
enum E { A = 4 }
{
  enum E { A = 0 }
  if (E.A) { module.exports = 1; }
}
(globalThis as any).mode = (function (this: unknown) { return this === undefined ? "strict" : "sloppy"; })();
