// The named imports come from the object that the import made, not from the one that require() returned earlier.
require("./app.mjs");
const data = require("./list.json");
console.log("main", JSON.stringify(data));
