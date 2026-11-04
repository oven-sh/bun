const { loaded } = require("./stage.cjs");
import("./two-late.mjs").then(loaded("late"));
import("./two-later.mjs").then(loaded("later"));
console.log("asks");
module.exports = {};
