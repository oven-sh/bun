// One of two files is exported whole by an environment variable.
const t = require("./t.cjs");
console.log(Object.keys(t).join(), t.v);
