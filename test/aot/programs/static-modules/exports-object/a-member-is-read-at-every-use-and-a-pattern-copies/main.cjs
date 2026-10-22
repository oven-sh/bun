// `a.n` is read at every use; a pattern copies.
// The exports of a.cjs were meant to be variables. They are the members of an object.
const a = require("./a.cjs"),
  { n } = a;
a.inc();
console.log(a.n, n);
