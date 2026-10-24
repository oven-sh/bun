// A pattern takes a name, and the module that is required next stores to that name.
const { n } = require("./x.cjs");
require("./y.cjs");
console.log(n, require("./x.cjs").n);
