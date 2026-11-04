const show = (m) => (m === undefined ? "undefined" : typeof m + ":" + JSON.stringify(m.exports) + ":" + typeof m.id + ":" + m.loaded);
console.log("ahead-of-the-require:", show(require.cache[require.resolve("./real.cjs")]));
require("./real.cjs");
