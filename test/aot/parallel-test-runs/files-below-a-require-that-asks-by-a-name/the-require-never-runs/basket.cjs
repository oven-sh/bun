console.log("basket.cjs runs");
exports.summary = () => "a basket with " + require("./totals.mjs").total;
