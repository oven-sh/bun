exports.x = "own";
let got;
{ let exports = require("./f11a").exports; got = exports.x; }
exports.got = got;
