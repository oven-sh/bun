// A function, an arrow and a class that a module stores once, at the top, behind the require that closes a cycle. A call from the other module comes before the store and throws a TypeError, although the declaration of the function is hoisted: the export is not there until its store has run.
const a = require("./a.cjs");
console.log(a.fromB);
console.log(require("./b.cjs").later());
