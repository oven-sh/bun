const tax = require("./tax.mjs");
console.log("price runs");
exports.total = () => "price " + tax.rate;
