const second = require("./second.mjs");
require("./gauge.cjs").raise();
const before = second.read();
const first = require("./first.mjs");
console.log(before === second.read(), before, second.read(), second.seen, first.read());
first.poke();
console.log(first.read(), second.read(), require("./gauge.cjs").level, require("./door.cjs").level);
