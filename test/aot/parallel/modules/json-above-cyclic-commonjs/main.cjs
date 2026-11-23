// list.json is one level above early.cjs, so the loader has visited it when early.cjs runs, and require() returns the namespace.
require("./app.mjs");
const list = require("./list.json");
console.log("main", Array.isArray(list), Object.keys(list).join());
