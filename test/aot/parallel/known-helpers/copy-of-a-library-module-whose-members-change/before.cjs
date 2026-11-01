const fs = require("node:fs");
const path = require("node:path");
fs.existsSync = function mine() { return "mine, stored before the import"; };
delete path.sep;
path.basename = () => "basename stored before the import";
