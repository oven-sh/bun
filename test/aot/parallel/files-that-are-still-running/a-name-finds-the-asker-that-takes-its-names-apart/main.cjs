// asker.cjs takes a name out of the first object of served.cjs, which has none yet.
const served = require("./served.cjs");
const asker = require("./asker.cjs");
console.log(asker.seen, served.version);
