// A name that only a computed key stores, and a name that comes from a prototype put behind the exports object. Both are read by name.
const a = require("./a.cjs");
console.log(a.x, a.y);
