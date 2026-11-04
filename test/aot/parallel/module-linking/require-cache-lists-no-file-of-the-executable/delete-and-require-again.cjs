const show = (m) => (m === undefined ? "undefined" : typeof m + ":" + JSON.stringify(m.exports) + ":" + typeof m.id + ":" + m.loaded);
globalThis.count = 0;
require("./counts.cjs");
delete require.cache[require.resolve("./counts.cjs")];
require("./counts.cjs");
console.log("delete-and-require-again:", globalThis.count);
