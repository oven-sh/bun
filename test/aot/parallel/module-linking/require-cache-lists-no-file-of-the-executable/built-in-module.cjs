const show = (m) => (m === undefined ? "undefined" : typeof m + ":" + JSON.stringify(m.exports) + ":" + typeof m.id + ":" + m.loaded);
require("node:path");
console.log("built-in-module:", show(require.cache["node:path"]), show(require.cache["path"]));
