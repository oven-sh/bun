// The default export that import() returns is not the object that require() returned earlier.
require("./app.mjs");
const list = require("./list.json");
console.log("main", Array.isArray(list), Object.keys(list).join());
