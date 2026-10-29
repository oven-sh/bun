if (Date.now() > 0) { module.exports = require("./dev.cjs"); return; }
module.exports = require("./prod.cjs");
