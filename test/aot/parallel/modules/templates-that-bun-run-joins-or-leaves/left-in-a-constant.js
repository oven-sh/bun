const t = `é${1}`;
if (t) {} else { module.exports = 1; }
globalThis.mode = (function () { return this === undefined ? "strict" : "sloppy"; })();
