// CommonJS, so that `require("assert")` and the default import are both the
// `assert` function, as in Node. See `commonJSFiles` in build-fallbacks.ts.
module.exports = require("./node_modules/assert");
