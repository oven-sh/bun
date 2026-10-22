// `module.exports = require("./x.cjs")`: the two files answer one object. One redirect adds to it. A chain of three redirects: a store through the last is read through the first.
const r = require("./r.cjs");
console.log(Object.keys(require("./x.cjs")).join(), r === require("./x.cjs"));
const last = require("./chain-3.cjs");
last.value = "stored through the last";
console.log(require("./chain-0.cjs").read(), require("./chain-1.cjs") === last);
