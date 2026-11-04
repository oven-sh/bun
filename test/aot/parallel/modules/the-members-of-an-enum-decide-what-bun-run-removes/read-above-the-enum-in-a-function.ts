// @ts-nocheck
function h() {
  if (F.B) {} else { module.exports = 1; }
  enum F { B = 1 }
}
(globalThis as any).mode = (function (this: unknown) { return this === undefined ? "strict" : "sloppy"; })();
