const path = require("node:path");
module.exports = [require(path.join(__dirname, "..", "data.json")).name, require(path.join(__dirname, "../lib/first.js")).name, require(path.resolve(__dirname, "..", "lib", "second.js")).name];
