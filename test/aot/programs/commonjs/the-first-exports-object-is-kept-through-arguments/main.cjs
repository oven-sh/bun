// The first exports object is kept through arguments.
const t = require("./t.cjs");
console.log(t.name, JSON.stringify(t.old), t.n, t.sameModule);
