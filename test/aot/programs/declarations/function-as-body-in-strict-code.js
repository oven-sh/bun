// A plain function declaration as the body of a label or of `if`, in strict code. ECMAScript rejects it there. Plain Bun runs it: its transpiler turns the function into a `let` in a block of its own. So the program builds, the name ends with the statement, and a binding of the same name around it is left alone. This CommonJS file is strict only inside the class.
module.exports = {};
function row(label, f) { let said; try { said = String(f()); } catch (e) { said = "threw " + e.name; } console.log(label + ": " + said); }
class Strict {
  static mode() { return (function () { return this === undefined ? "strict" : "sloppy"; })(); }
  static labeled() { const before = typeof inner; again: function inner() { return 1; } return before + " " + typeof inner; }
  static twoLabels() { outer: again: function inner() { return 1; } return typeof inner; }
  static labeledInBlock() { { again: function inner() { return 1; } } return typeof inner; }
  static underIf(flag) { if (flag) function inner() { return 1; } return typeof inner; }
  static underElse(flag) { if (flag) ; else function inner() { return 1; } return typeof inner; }
  static besideConst() { const inner = "const"; again: function inner() { return 1; } return inner; }
  static besideParameter(inner) { if (inner) function inner() { return 1; } return inner; }
}
row("control: which mode the file is in", () => (function () { return this === undefined ? "strict" : "sloppy"; })());
row("control: which mode the class is in", () => Strict.mode());
row("under a label", () => Strict.labeled());
row("under two labels", () => Strict.twoLabels());
row("under a label in a block", () => Strict.labeledInBlock());
row("under if, taken", () => Strict.underIf(true));
row("under if, not taken", () => Strict.underIf(false));
row("under else, taken", () => Strict.underElse(false));
row("under else, not taken", () => Strict.underElse(true));
row("under a label, beside a const of the name", () => Strict.besideConst());
row("under if, beside a parameter of the name", () => Strict.besideParameter("parameter"));
