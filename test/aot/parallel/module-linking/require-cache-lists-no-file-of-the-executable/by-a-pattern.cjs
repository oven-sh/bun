const show = (m) => (m === undefined ? "undefined" : typeof m + ":" + JSON.stringify(m.exports) + ":" + typeof m.id + ":" + m.loaded);
require("./real.cjs");
const { [require.resolve("./real.cjs")]: entry } = require.cache;
console.log("by-a-pattern:", show(entry));
