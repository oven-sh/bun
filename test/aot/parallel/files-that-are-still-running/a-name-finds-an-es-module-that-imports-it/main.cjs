// asker.mjs imports served.cjs while that file still runs: its default is the first object.
const served = require("./served.cjs");
require("./asker.mjs");
console.log(globalThis.seen, typeof served);
