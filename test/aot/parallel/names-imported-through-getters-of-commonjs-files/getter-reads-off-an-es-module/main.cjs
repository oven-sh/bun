const first = require("./first.mjs");
first.poke();
const porch = require("./porch.cjs");
first.poke();
const third = require("./third.mjs");
first.poke();
console.log(first.read(), porch.level, third.read(), require("./door.cjs").level);
