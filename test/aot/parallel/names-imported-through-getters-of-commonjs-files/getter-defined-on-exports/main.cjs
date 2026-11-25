const first = require("./first.mjs");
first.poke();
const before = first.read();
const second = require("./second.mjs");
console.log(before === first.read(), before, first.read(), second.seen);
first.poke();
console.log(first.read(), second.read(), require("./gauge.cjs").level, require("./door.cjs").level);
