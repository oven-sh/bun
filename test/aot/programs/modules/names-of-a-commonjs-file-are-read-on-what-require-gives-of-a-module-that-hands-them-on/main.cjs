// An ES module hands on names that a CommonJS file stores one by one. Another CommonJS file requires the ES module and reads the names on what it
// got, under a dot and under a written key.
const all = require("./hands-on.mjs");
console.log(all.number, typeof all["greet"], require("./hands-on.mjs").text);
