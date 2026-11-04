const show = (m) => (m === undefined ? "undefined" : typeof m + ":" + JSON.stringify(m.exports) + ":" + typeof m.id + ":" + m.loaded);
require("./real.cjs");
console.log("by-what-resolve-answers:", show(require.cache[require.resolve("./real.cjs")]));
