const list = require("./list.json");
console.log("second", Array.isArray(list), Object.keys(list).join());
const more = require("./more.json");
console.log("second more", Array.isArray(more), Object.keys(more).join());
