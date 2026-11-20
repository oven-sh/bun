// asker.cjs takes a name out of the first object of the main file, which has none yet.
const asker = require("./asker.cjs");
module.exports = { version: 3 };
console.log(asker.seen, module.exports.version);
