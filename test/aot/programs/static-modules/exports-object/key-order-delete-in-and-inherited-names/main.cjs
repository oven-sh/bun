// The order of the keys is the order of the stores; `delete`, `in` and inherited names work.
const a = require("./a.cjs");
console.log(Object.keys(a).join(), "c" in a, typeof a.toString, a.hasOwnProperty("a"));
