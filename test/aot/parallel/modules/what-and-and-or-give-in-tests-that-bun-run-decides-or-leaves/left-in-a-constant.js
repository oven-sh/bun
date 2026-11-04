const a = 0x0n || "x";
if (a) {} else { module.exports = 1; }
globalThis.mode = (function () { return this === undefined ? "strict" : "sloppy"; })();
