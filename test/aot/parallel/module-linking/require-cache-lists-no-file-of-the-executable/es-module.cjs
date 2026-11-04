const show = (m) => (m === undefined ? "undefined" : typeof m + ":" + JSON.stringify(m.exports) + ":" + typeof m.id + ":" + m.loaded);
require("./real.mjs");
console.log("es-module:", show(require.cache[require.resolve("./real.mjs")]));
