const price = require("./price.cjs");
console.log("shop runs");
exports.sold = () => "shop " + price.total();
