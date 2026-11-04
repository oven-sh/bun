// @ts-nocheck
{ enum F { B = 1 } }
if (typeof F !== "undefined" && F.B) {} else { module.exports = 1; }
(globalThis as any).mode = (function (this: unknown) { return this === undefined ? "strict" : "sloppy"; })();
