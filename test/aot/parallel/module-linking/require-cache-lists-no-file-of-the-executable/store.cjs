const show = (m) => (m === undefined ? "undefined" : typeof m + ":" + JSON.stringify(m.exports) + ":" + typeof m.id + ":" + m.loaded);
require.cache[require.resolve("./stored-over.cjs")] = { exports: { name: "stored" }, loaded: true, id: "x" };
console.log("store:", require("./stored-over.cjs").name);
