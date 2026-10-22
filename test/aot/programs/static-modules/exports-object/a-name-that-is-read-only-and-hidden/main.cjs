// A name that Object.defineProperty makes read-only and hidden: the later store does nothing.
const a = require("./a.cjs");
console.log(a.fixed, Object.keys(a).join(), JSON.stringify(Object.getOwnPropertyDescriptor(a, "fixed")));
