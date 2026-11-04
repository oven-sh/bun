// @ts-nocheck
enum F { B = "a" + "b", C = `${B}c` }
if (F.C === "abc") {} else { module.exports = 1; }
(globalThis as any).mode = (function (this: unknown) { return this === undefined ? "strict" : "sloppy"; })();
