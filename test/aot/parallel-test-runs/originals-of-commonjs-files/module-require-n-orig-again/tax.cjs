console.log("SAID body of tax");
exports.rate = 1;
exports.fee = () => module.require("./dep.cjs").name;
exports.show = () => require.main === module;
