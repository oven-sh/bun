console.log("SAID body of tax");
exports.rate = 1;
let dep;
exports.fee = () => (dep ??= require("./dep.cjs")).name;
exports.show = () => require("./" + "dep" + ".cjs").name;
