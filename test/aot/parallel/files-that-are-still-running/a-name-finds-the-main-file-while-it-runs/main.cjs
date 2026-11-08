// asker.cjs loads the main file by a name that the build cannot read, while the main file still runs: it gets the first object of the main file.
const asker = require("./asker.cjs");
module.exports = function serve() {};
console.log(asker.seen, typeof module.exports);
