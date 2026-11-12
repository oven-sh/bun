const first = require("./first.mjs");
first.poke();
const before = first.read();
const second = require("./second.mjs");
console.log(before === first.read(), typeof before, typeof second.seen, JSON.stringify(before), JSON.stringify(first.read()), JSON.stringify(second.seen));
