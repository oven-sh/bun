// A function that is exported under a name and replaced later: a call through the holder finds the new one, what a pattern took is the old one.
// The exports of a.cjs were meant to be variables. They are the members of an object.
const a = require("./a.cjs"),
  { f } = a;
a.swap();
console.log(a.f(), f());
