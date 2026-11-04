const show = (m) => (m === undefined ? "undefined" : typeof m + ":" + JSON.stringify(m.exports) + ":" + typeof m.id + ":" + m.loaded);
require("./data.json");
console.log("json:", show(require.cache[require.resolve("./data.json")]));
