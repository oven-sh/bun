const tax = require("./tax.cjs");
console.log("price runs");
exports.total = () => "price " + tax.rate;
