console.log("SAID body of tax");
const { createRequire } = require("node:module");
const r = createRequire(__filename);
exports.rate = 1;
exports.fee = () => r("./dep.cjs").name;
exports.show = () => r === require;
