console.log("SAID body of tax");
const data = require("./data.json");
exports.rate = data.rate;
exports.fee = () => { data.rate++; return data.rate; };
exports.show = () => require("./data.json") === data;
