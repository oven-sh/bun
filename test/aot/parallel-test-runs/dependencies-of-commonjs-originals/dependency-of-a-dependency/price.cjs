const tax = require("./rates.cjs");
console.log("price runs");
exports.total = () => "price " + tax.rate;
