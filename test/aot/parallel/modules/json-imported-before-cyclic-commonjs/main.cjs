// app.mjs imports list.json first and early.cjs second. The loader makes both modules before it visits either, and early.cjs runs when it is made.
// So its require() of list.json still returns the value, not the namespace.
require("./app.mjs");
const list = require("./list.json");
console.log("main", Array.isArray(list), Object.keys(list).join());
