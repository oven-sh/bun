// The load stands in a function of loader.cjs, which served.cjs calls while it runs.
const served = require("./served.cjs");
const asker = require("./asker.cjs");
console.log(asker.seen, typeof served);
