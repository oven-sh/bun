// early.cjs requires list.json before the loader visits it. The import that follows gets an object of its own, so the push in early.cjs shows only in later require() calls.
require("./app.mjs");
const list = require("./list.json");
console.log("main", JSON.stringify(list.default ?? list));
