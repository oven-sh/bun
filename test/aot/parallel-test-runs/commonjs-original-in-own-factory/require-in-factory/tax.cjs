console.log("SAID body of tax");
let asked = 0;
function tax() { return "tax " + asked; }
tax.rate = 2;
tax.fee = () => ++asked;
tax.box = { n: 0 };
module.exports = tax;
