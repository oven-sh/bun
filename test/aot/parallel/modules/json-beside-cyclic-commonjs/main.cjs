// a.mjs imports list.json and b.mjs imports early.cjs. Both files are on one level of the graph, so early.cjs runs before the loader visits list.json.
require("./app.mjs");
const list = require("./list.json");
console.log("main", Array.isArray(list), Object.keys(list).join());
