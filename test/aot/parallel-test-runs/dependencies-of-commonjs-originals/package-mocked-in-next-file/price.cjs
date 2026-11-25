const tax = require("@made-up/tax");
console.log("price runs");
exports.total = () => "price " + tax.rate;
