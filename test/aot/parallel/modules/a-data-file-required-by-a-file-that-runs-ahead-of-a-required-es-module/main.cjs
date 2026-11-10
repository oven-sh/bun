// A require written at the top of a file loads the graph of an ES module at once. The CommonJS file that the graph imports runs ahead of it, and to the loader nothing of the graph is there
// yet: its require of the data file that the graph imports too gets the value, not the namespace. So does every later require: the first answer is kept.
const space = require("./app.mjs");
console.log(typeof space);
require("./later.cjs");
