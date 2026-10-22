// A method of `module.exports = { .. }` finds what lies above the literal through `super`, however it is called.
const { above, own, plain } = require("./module.cjs");
console.log(above.call({}), above.call([1, 2]), own.call({ n: 2 }), plain());
const whole = require("./whole.cjs");
console.log(whole.above(), whole.own(), Object.keys(whole).join());
