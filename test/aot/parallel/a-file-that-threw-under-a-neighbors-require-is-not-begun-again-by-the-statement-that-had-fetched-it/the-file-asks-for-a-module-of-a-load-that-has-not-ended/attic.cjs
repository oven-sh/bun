exports.found = "nothing";
try {
  exports.found = require("./trunk.mjs").label;
} catch {}
