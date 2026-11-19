const list = require("./list.json");
console.log("second", JSON.stringify(list.default ?? list), list === globalThis.first);
