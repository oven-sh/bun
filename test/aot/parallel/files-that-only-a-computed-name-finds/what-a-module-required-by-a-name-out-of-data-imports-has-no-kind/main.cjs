// The name of plug.mjs comes out of config.json, and a require() takes it. What plug.mjs imports runs inside that require: plain.cjs, which says nothing of its kind, is a CommonJS file there.
const plug = require(require("./config.json").plugin);
console.log(plug.kind, "|", plug.shape);
