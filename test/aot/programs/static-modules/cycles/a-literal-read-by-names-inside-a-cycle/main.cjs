// `module.exports = { one, two }` as the last statement of a module on a cycle, read by names alone. The other module required it too early: its holder stands for the first object, which never gets the names. A holder that is made later reads them.
const literal = require("./literal.cjs");
const early = require("./early.cjs");
console.log(early.oneThen, early.twoThen);
console.log(literal.one, literal.two, early.oneLater(), early.twoLater());
