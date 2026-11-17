console.log("SAID body of tax");
module.exports = function tax(x) { return x * module.exports.rate; };
module.exports.rate = 1;
module.exports.show = () => module.exports(4);
module.exports.fee = () => typeof module.exports;
