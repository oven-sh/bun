// `(f(), module).exports` calls `f`, wherever it stands, and another file gets what was stored through it.
const other = require("./other.cjs");
console.log(Object.keys(other).join(), other.two, other.twelve);
