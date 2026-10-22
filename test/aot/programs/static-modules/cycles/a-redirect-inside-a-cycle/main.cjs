// `module.exports = require("./x.cjs")` and nothing else, where x requires that file back: x finds the first, empty exports object of the redirect. Behind the cycle both names answer one object.
const r = require("./r.cjs");
console.log(r.sawKeysOfR, r.early, r.late, r.rLater(), r === require("./x.cjs"));
