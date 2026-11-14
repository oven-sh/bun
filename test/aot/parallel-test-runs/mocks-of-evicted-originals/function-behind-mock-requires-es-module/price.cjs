console.log("price runs");
exports.total = () => "price " + require("./tax.mjs").rate;
