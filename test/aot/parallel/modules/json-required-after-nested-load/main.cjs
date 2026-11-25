// early.cjs loads other.mjs, which imports more.json. That load ends inside early.cjs, so the require() that follows returns the namespace of more.json.
require("./app.mjs");
const list = require("./list.json");
console.log("main", Array.isArray(list), Object.keys(list).join());
