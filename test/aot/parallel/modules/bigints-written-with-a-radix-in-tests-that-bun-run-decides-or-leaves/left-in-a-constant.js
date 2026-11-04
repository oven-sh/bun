const b = 0x1n;
if (b) {} else { module.exports = 1; }
globalThis.mode = (function () { return this === undefined ? "strict" : "sloppy"; })();
