console.log("SAID body of tax");
const esm = require("./esm.mjs");
exports.rate = esm.rate;
exports.fee = () => esm.bump();
exports.show = () => esm.rate;
