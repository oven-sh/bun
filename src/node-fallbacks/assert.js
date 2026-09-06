// CommonJS on purpose: `require("assert")` must return the callable `assert`
// function itself, not an ESM namespace (browserify-zlib calls it directly).
module.exports = require("./node_modules/assert");
