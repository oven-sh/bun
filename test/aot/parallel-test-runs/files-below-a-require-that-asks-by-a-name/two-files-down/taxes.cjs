console.log("taxes.cjs runs");
const { region } = require("./regions.mjs");
exports.tax = "a tax of " + region;
