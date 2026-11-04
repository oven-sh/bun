function tag() { return 1; }
if (tag`a`) {} else { module.exports = 1; }
globalThis.mode = (function () { return this === undefined ? "strict" : "sloppy"; })();
