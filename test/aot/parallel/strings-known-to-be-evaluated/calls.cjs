// Direct evals of calls: the strings that the constants of the file lead to are compiled, the others are interpreted, and all do what the strings say.
var log = [];
function arrayExists(array, x) {
  for (var i = 0; i < array.length; i++) if (array[i] == x) return true;
  return false;
}
Date.prototype.formatted = function (input, time) {
  var switches = ["a", "B", "Y", "m", "q"];
  function a() { return self.getUTCHours() > 11 ? "pm" : "am"; }
  function B() { return Math.floor(self.getTime() / 86400000) % 1000; }
  function Y() { if (self.getUTCFullYear) return self.getUTCFullYear(); }
  function m() { return (self.getUTCMonth() < 9 ? "0" : "") + (self.getUTCMonth() + 1); }
  function q() { throw new RangeError("q " + typeof arguments + arguments.length); }
  var self = this;
  var ia = input.split("");
  var ij = 0;
  while (ia[ij]) {
    if (ia[ij] == "\\") ia.splice(ij, 1);
    else if (arrayExists(switches, ia[ij])) ia[ij] = eval(ia[ij] + "()");
    ij++;
  }
  return ia.join("");
};
var date = new Date(1163000000000);
log.push(date.formatted("Y-m a"), date.formatted("B \\Y Y"));
try { date.formatted("q"); } catch (e) { log.push(e.message, e instanceof RangeError); }
function unknown(text) { return date.formatted(text); }
log.push(unknown(String(process.argv.length > 0 ? "m/Y" : "")));
// Other calls, and what is no call.
var holder = { total: 0, add(x, y) { this.total += x + (y ?? 0); return this; } };
function sum(x, y) { return x + y; }
function evaluate(x, y) {
  var inner = 10, made = [];
  for (var text of ["sum(x, y)", "holder.add(x)", "holder.add(sum(x, 1), y).total", "sum(inner, inner++)", "sum (x, 2) ;", "made.push(x, y);;", "String(x)", "sum(x, (function (z) { return z * 2; })(y))", " sum(1, 2)", "sum(typeof missing, typeof text)", "parseInt('12px')", "holder.add(inner = 5).total + 1", "sum(x, y), 7", "x ? sum(x) : 0"]) {
    var value = eval(text);
    made.push(value === holder ? "holder" : value);
  }
  return made.join("|") + inner;
}
log.push(evaluate(1, 2), evaluate("s", "t"), holder.total);
function failing(name) { return eval(name + "(1)"); }
for (var f of ["absent", "log.absent", "failing.name", "Symbol.iterator", "log.push.call.x"]) try { log.push(failing(f)); } catch (e) { log.push(e.name, e.message); }
function shadowed(sum) { eval("var local = sum(3, 4)"); return eval("sum(5, 6)") + local; }
log.push(shadowed((x, y) => x * y));
function declared() { eval("function sum() { return 'declared'; }"); return eval("sum(1, 2)"); }
function later(t) { var r = []; for (var i = 0; i < 3; i++) { r.push(eval("sum(1, 2)")); if (i === t) eval("var sum = () => 'later'"); } return r.join(); }
log.push(declared(), later(1), later(9));
(function () { function own() { return typeof this; } log.push(eval("own()"), eval("String(typeof own)")); })();
function* steps() { var n = 1; function next() { return n++; } yield eval("next()"); yield eval("next()"); }
log.push([...steps()].join());
async function waits() { var n = 1; function next() { return n++; } await 0; return eval("next()") + eval("next()"); }
class Base { get value() { return 3; } method() { const read = () => this.value; return eval("read()"); } }
log.push(new Base().method());
const arrow = (x) => eval("sum(x, x)");
log.push(arrow(4));
function usesArguments() { return eval("sum(arguments[0], arguments.length)"); }
log.push(usesArguments(5, 6));
function usesThis() { return eval("this.add(1).total"); }
log.push(usesThis.call({ total: 1, add(x) { this.total += x; return this; } }));
var eval2 = eval;
{ let eval = t => "other " + t; log.push((function (sum) { return 1; })(2)); }
function otherEval(eval, text) { return eval("sum(1, 2)"); }
log.push(otherEval(t => "other " + t), otherEval(eval2));
waits().then(v => { log.push(v); console.log(log.join("\n")); });
