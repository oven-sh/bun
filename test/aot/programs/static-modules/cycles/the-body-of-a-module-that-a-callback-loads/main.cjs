// A callback in a third module loads `peek`, and the BODY of peek requires m at the top while m runs. m then replaces its exports, so peek holds the first object for ever. No function of peek has a require in it.
require("./registers.cjs");
require("./m.cjs");
const peek = require("./peek.cjs");
console.log(peek.read(), require("./m.cjs").late);
