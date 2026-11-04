const show = (m) => (m === undefined ? "undefined" : typeof m + ":" + JSON.stringify(m.exports) + ":" + typeof m.id + ":" + m.loaded);
require("./real.cjs");
console.log("by-the-folder-and-a-name:", show(require.cache[__dirname + "/real.cjs"]));
