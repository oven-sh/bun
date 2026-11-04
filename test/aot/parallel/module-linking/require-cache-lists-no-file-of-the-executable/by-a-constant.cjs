const show = (m) => (m === undefined ? "undefined" : typeof m + ":" + JSON.stringify(m.exports) + ":" + typeof m.id + ":" + m.loaded);
const path = require.resolve("./real.cjs");
require("./real.cjs");
console.log("by-a-constant:", show(require.cache[path]));
