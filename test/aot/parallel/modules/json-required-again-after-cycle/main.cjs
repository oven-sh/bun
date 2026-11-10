require("./app.mjs");
const list = require("./list.json");
console.log("main", Array.isArray(list), Object.keys(list).join());
