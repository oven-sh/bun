const live = require("./live.cjs");
live.bump();
exports.seenByRequire = live.n;
