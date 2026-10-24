// A bundle in the commonjs format of bun build is required.
const m = require("./m.cjs");
console.log(JSON.stringify(m), typeof m);
