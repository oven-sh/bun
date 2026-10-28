// A file on a cycle holds the exports object that is replaced later.
const a = require("./a.cjs");
console.log(a.name, a.b.held === a, a.b.heldName(), a.b.again() === a);
