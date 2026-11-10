console.log("basket.cjs runs");
const { total } = require("./totals.mjs");
exports.summary = "a basket with " + total;
