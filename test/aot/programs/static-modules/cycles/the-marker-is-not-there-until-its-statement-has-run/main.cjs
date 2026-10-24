// A module that is found half evaluated has its `__esModule` only from the statement on that gives it.
const late = require("./late.cjs");
const early = require("./early.cjs");
console.log(late.seen, late.default, early.seen, early.default);
