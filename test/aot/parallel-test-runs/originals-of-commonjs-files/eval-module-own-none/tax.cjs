console.log("SAID body of tax");
exports.rate = 1;
const hidden = "h";
exports.fee = () => eval("hidden + exports.rate");
exports.show = () => typeof eval("module");
