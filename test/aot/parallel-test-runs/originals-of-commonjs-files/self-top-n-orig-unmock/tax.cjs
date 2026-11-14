console.log("SAID body of tax");
exports.rate = 1;
const me = require(__filename);
exports.fee = () => me.rate;
exports.show = () => me === module.exports;
