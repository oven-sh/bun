const fs = require("node:fs");
exports.held = { folder: __dirname, length: fs.readFileSync(__filename, "utf8").length };
