// A file on a cycle sees the exports stored so far.
const a = require("./a.cjs");
console.log(a.early, a.late, a.seenByB);
