const show = (m) => (m === undefined ? "undefined" : typeof m + ":" + JSON.stringify(m.exports) + ":" + typeof m.id + ":" + m.loaded);
require("./real.cjs");
console.log("in:", require.resolve("./real.cjs") in require.cache, "nothing" in require.cache);
