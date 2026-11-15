console.log("SAID body of tax");
Object.assign(exports, require("./inner.cjs"));
exports.rate = 1;
exports.show = () => exports.fee() + "m";
