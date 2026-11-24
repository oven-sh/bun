// The entry has required the file that is changed.
const config = require("./config.cjs");
require("./start.mjs");
console.log("main", config.level);
