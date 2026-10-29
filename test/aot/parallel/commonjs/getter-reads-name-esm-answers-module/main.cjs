// hands-on.mjs exports names of counter.cjs again, so it holds what they were when counter.cjs was linked. A getter of another CommonJS file that returns such a name of hands-on.mjs answers that, whatever counter.cjs stores later.
const handsOn = require("./hands-on.mjs");
const throughAGetter = require("./through-a-getter.cjs");
const throughTwoGetters = require("./through-two-getters.cjs");
const straight = require("./straight-off-the-file.cjs");

console.log(handsOn.count, throughAGetter.count, throughTwoGetters.count, straight.count);
handsOn.add();
console.log(handsOn.count, throughAGetter.count, throughTwoGetters.count, straight.count);
const { count } = require("./through-a-getter.cjs");
console.log(count, require("./counter.cjs").count);
