const show = (m) => (m === undefined ? "undefined" : typeof m + ":" + JSON.stringify(m.exports) + ":" + typeof m.id + ":" + m.loaded);
require("./real.cjs");
console.log("cache-of-the-module-module:", show(require("node:module")._cache[require.resolve("./real.cjs")]));
