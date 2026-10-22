function make() { return { early: "early", seenByImporter: undefined }; }
module.exports = make();
module.exports.seenByImporter = require("./imports-back.mjs").seen;
module.exports.late = "late";
