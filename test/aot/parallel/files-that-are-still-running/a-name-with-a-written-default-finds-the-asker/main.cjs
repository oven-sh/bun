// The load in served.cjs finds asker.cjs by the text that spells it, while served.cjs still runs: asker.cjs gets the first object of served.cjs.
const served = require("./served.cjs");
const asker = require("./asker.cjs");
console.log(asker.seen, typeof served);
