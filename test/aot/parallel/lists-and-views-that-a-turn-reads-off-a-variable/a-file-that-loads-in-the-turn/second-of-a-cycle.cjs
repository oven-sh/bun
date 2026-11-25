const first = require("./first-of-a-cycle.cjs");
let early; try { early = first.sum(0) + " " + first.sum(2); } catch (error) { early = error.constructor.name; }
exports.early = early;
