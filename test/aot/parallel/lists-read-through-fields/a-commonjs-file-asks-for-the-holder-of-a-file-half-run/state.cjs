class Shelf { constructor(rows) { this.rows = rows; } }
const reader = require("./reader.cjs");
try { console.log("SAID early", reader.sum(0)); } catch (error) { console.log("SAID early", error.name); }
exports.shelf = new Shelf(JSON.parse(process.argv[2] ?? "[1,2,3]"));
console.log("SAID behind", reader.sum(0));
