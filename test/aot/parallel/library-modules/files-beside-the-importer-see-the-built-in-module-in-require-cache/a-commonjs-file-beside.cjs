exports.seen = ["ws" in require.cache, Object.keys(require.cache).includes("ws")].join(" ");
exports.later = () => require("ws");
