console.log("SAID body of tax");
let asked = 0;
module.exports = { rate: 1, fee() { return ++asked; }, show() { return module.exports.rate + this.fee(); } };
