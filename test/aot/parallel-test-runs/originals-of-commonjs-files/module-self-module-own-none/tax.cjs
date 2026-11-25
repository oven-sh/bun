console.log("SAID body of tax");
module.exports.rate = 1;
module.exports.fee = function () { return module.exports.rate + 1; };
module.exports.show = () => module.exports.fee() + exports.rate;
