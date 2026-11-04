const show = (m) => (m === undefined ? "undefined" : typeof m + ":" + JSON.stringify(m.exports) + ":" + typeof m.id + ":" + m.loaded);
require("./real.cjs");
console.log("by-a-joined-path:", show(require.cache[require("node:path").join(__dirname, "real.cjs")]));
