// `exports = module.exports = value` as a statement of the body stores to a name that the body needs no parameter for, so the file keeps no module object: nobody writes down who requires it, though another file of the
// program asks who has required that one. The four records are those of the two calls in this file, which the file that asks leads to.
// STATISTIC: RequiresRecorded = 4
const { make } = require("./user.cjs");
require("./asks.cjs");
console.log(make());
