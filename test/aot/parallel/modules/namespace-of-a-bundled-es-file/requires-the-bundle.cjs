const bundle = require("./commonjs-arrow.mjs");
module.exports = Object.keys(bundle).join() + " " + bundle.x();
