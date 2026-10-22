// Exports under the names of members of Object.prototype, and under an index.
const a = require("./a.cjs");
console.log(a.constructor, `${a}`, a[0], a.hasOwnProperty("x"), Object.keys(a).join());
