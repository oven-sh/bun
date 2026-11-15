console.log("SAID body of tax");
let asked = 0;
exports.rate = 1;
exports.fee = () => ++asked;
exports.show = () => exports.rate + exports.fee();
