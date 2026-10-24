exports.x = "own";
let got;
{ const { exports } = require("./f7a"); got = exports.x; }
exports.got = got;
