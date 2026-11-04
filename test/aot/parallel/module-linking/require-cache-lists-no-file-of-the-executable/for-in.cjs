const show = (m) => (m === undefined ? "undefined" : typeof m + ":" + JSON.stringify(m.exports) + ":" + typeof m.id + ":" + m.loaded);
require("./real.cjs");
let count = 0;
for (const key in require.cache) count++;
console.log("for-in:", count);
