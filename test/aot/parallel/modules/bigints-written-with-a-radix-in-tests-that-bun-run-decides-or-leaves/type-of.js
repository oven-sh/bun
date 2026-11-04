if (typeof 0x1n === "bigint") {} else { module.exports = 1; }
globalThis.mode = (function () { return this === undefined ? "strict" : "sloppy"; })();
