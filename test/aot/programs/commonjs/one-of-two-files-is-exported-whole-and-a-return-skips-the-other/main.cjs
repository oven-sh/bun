// One of two files is exported whole and a return skips the other.
const t = require("./t.cjs");
console.log(Object.keys(t).join(), t.v);
