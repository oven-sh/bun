// Both CommonJS files get the same object from require(). The import between them gets its own.
require("./app.mjs");
const list = require("./list.json");
console.log("main", JSON.stringify(list.default ?? list));
