const lib = require("./lib.cjs");
const o = { lib: { a: 9 } };
with (o) { console.log(lib.a); }
