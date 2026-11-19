const tax = require("../../../tax.json");
console.log("price runs");
exports.total = () => "price " + tax.rate;
