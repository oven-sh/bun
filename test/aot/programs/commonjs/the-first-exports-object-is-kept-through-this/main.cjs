// The first exports object is kept through this.
const t = require("./t.cjs");
console.log(JSON.stringify(t), t.old === t, JSON.stringify(t.old), t.same);
