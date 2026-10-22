exports.useConst = () => b.value;
exports.useVar = () => c.value;
const b = require("./b.cjs");
var c = require("./c.cjs");
exports.results = [b.sawConst, c.sawVar, exports.useConst(), exports.useVar()].join();
