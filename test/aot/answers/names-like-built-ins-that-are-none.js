// answers: with-library
// # A parameter, a variable, a class or a caught value that is named like a built-in is none: nothing is decided by the text of a name.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 14 of 14 of 14
// # CHECK-NEXT: exited with 0
function withParameter(Number, value) { return Number(value); }
report(withParameter(value => "mine: " + value, 5));
function withMath(Math) { return Math.floor(1.5); }
report(withMath({ floor() { return "floored here"; } }));
function withVariable() { var parseInt = () => "no number"; return parseInt("12"); }
report(withVariable());
function withConstant() { const String = value => value + 1; return String(1); }
report(withConstant());
function withFunction() { function Boolean() { return "neither"; } return Boolean(0); }
report(withFunction());
function withClass() { class Array { static isArray() { return "my own class"; } } return Array.isArray([]); }
report(withClass());
function inLoop(Math, count) { let sum = ""; for (let i = 0; i < count; i++) sum += Math.min(i, 1); return sum; }
report(inLoop({ min(a, b) { return "<" + a + b + ">"; } }, 3));
class Holder { charCodeAt() { return "a method of the program"; } push() { return "pushed nowhere"; } get length() { return "long"; } }
function codeOf(holder) { return holder.charCodeAt(0); }
report(codeOf(new Holder()));
report(new Holder().push(1));
report(new Holder().length);
const JSON = { stringify() { return "not the engine's"; } };
report(JSON.stringify({ a: 1 }));
function caught() { try { throw value => "thrown: " + value; } catch (Number) { return Number(1); } }
report(caught());
function destructured({ Number }) { return Number("7"); }
report(destructured({ Number: value => value + value }));
report("end");
