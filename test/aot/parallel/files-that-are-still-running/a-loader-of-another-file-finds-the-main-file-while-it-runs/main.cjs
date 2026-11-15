// The load stands in a function of loader.cjs, which asker.cjs calls while the main file runs.
const asker = require("./asker.cjs");
module.exports = function serve() {};
console.log(asker.seen, typeof module.exports);
