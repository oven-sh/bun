console.log("SAID body of tax");
class Tax { static rate = 1; static fee() { return new Tax().f(); } f() { return "f" + Tax.rate; } static show() { return this === module.exports; } }
module.exports = Tax;
