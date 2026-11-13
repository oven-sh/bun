const first = require("./first.mjs");
first.poke();
const second = require("./second.mjs");
first.poke();
const third = require("./third.mjs");
first.poke();
console.log(first.read(), second.read(), third.read(), require("./gauge.cjs").level);
