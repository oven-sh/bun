const log = exports.log = [];
using r = { [Symbol.dispose]() { log.push("dispose sees " + exports.a + " " + exports.b + " " + typeof x); } };
exports.a = 1;
const x = require("./x.cjs");
exports.b = x.v;
log.push("end");
