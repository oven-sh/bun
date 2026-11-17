// RUN: lower
// OPTIONS: builtin-modules
// DIAGNOSTIC: TS1156 7

// A plain function declaration as the body of a label or of `if`, in strict code. ECMAScript rejects it there, and so does plain Bun. The build stops at each of the seven. This CommonJS file is strict only inside the class: the function below the class is sloppy code, where both forms are valid.
module.exports = {};
console.log("never printed");
class Strict {
  static labeled() { const before = typeof inner; again: function inner() { return 1; } return before + " " + typeof inner; }
  static twoLabels() { outer: again: function inner() { return 1; } return typeof inner; }
  static labeledInBlock() { { again: function inner() { return 1; } } return typeof inner; }
  static underIf(flag) { if (flag) function inner() { return 1; } return typeof inner; }
  static underElse(flag) { if (flag) ; else function inner() { return 1; } return typeof inner; }
  static besideConst() { const inner = "const"; again: function inner() { return 1; } return inner; }
  static besideParameter(inner) { if (inner) function inner() { return 1; } return inner; }
}
function sloppy(flag) { again: function inner() { return 1; } if (flag) function other() { return 2; } return typeof inner + " " + typeof other; }
console.log(sloppy(true), Strict);
