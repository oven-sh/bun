const b = require("./b.cjs");
module.exports = { ...b, outer: () => "a over " + b.inner() };
