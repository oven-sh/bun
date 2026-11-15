console.log("SAID body of tax");
exports.rate = 1;
exports.fee = () => require(__filename).rate;
exports.show = () => require(__dirname + "/dep.cjs").name;
