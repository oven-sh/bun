function say(name, value) { console.log(name + ": " + String(value)); }
function same() { return arguments.callee === same; }
function named() { return arguments.callee.name + ":" + arguments.callee.length + ":" + arguments.length; }
function counted(a, b) { return arguments.length + ":" + arguments.callee.length; }
function makes(k) { return function inner() { return arguments.callee === inner ? k + arguments.length : -1; }; }
function overwritten() { arguments.callee = 5; return arguments.callee; }
function deleted() { delete arguments.callee; return String(arguments.callee) + ("callee" in arguments); }
function listed() { return Object.getOwnPropertyNames(arguments).join(); }
function enumerable() { var out = ""; for (var k in arguments) out += k + ";"; return out + JSON.stringify(arguments) + Object.keys(arguments).length; }
function tagged() { return Object.prototype.toString.call(arguments); }
function fresh() { return arguments; }
function outer(x) { function inner() { return arguments.length + ":" + (arguments.callee === inner); } return inner(x, x) + "|" + arguments.length + ":" + (arguments.callee === outer); }
function arrows() { var f = () => arguments.callee === arrows && arguments.length; return f(1, 2, 3); }
function defaults(a = 1) { "no directive"; try { return typeof arguments.callee; } catch (e) { return e.name; } }
function forwards() { return counted.apply(this, arguments); }
function factorial(n) { return n <= 1 ? 1 : n * arguments.callee(n - 1); }
var sum = 0;
for (var i = 0; i < 5; i++) {
  say("same", same(i)); say("named", named(i, i)); say("counted", counted(i)); say("makes", makes(i)(1, 2)); say("overwritten", overwritten()); say("deleted", deleted());
  say("listed", listed(i, i)); say("enumerable", enumerable(i, "x")); say("tagged", tagged()); say("fresh", fresh(i) === fresh(i)); say("fresh callee", fresh(i).callee === fresh);
  say("outer", outer(i)); say("arrows", arrows(i, i)); say("defaults", defaults()); say("forwards", forwards(i, i, i)); say("factorial", factorial(i + 3));
}
