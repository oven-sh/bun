const first = require("./first.mjs");
require("./lever.cjs");
const before = first.read();
const second = require("./second.mjs");
console.log(before === first.read(), before, first.read(), second.seen, require("./gauge.cjs").level);
