const first = require("./first.mjs");
require("./lever.cjs").put(require("./gauge.cjs"), ["le", "vel"].join(""), 2);
const before = first.read();
const second = require("./second.mjs");
console.log(before === first.read(), before, first.read(), second.seen, require("./gauge.cjs").level);
