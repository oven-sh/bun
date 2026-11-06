var load = require;
var holder = { load: require };
module.exports = { alias: load("../real.js"), method: holder.load("../real.js"), called: require.call(null, "../real.js"), applied: require.apply(null, ["../real.js"]) };
