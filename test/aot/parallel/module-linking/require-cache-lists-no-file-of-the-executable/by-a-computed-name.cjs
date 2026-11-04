const show = (m) => (m === undefined ? "undefined" : typeof m + ":" + JSON.stringify(m.exports) + ":" + typeof m.id + ":" + m.loaded);
require("./real.cjs");
const key = "./real" + ".cjs";
console.log("by-a-computed-name:", show(require.cache[require.resolve(key)]));
