// The text that a compiler prints for an enum, in a file that runs behind one that has frozen Object.prototype: the stores under names that it has are dropped in sloppy code.
require("./harden.cjs");
const { read } = require("./kinds.cjs");
console.log(Object.keys(read()).join(), typeof read().toString, read()[1], read().plain);
