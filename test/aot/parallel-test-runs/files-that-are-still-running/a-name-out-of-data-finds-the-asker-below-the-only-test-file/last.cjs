const served = require("./served.cjs");
const asker = require("./asker.cjs");
exports.seen = asker.seen;
exports.kind = typeof served;
