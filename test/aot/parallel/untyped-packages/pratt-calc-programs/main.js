// An untyped package and a program of it (programs): a lexer, a parser by precedence, an evaluator with scopes, a printer, a simplifier and code for a stack machine
const lib = require("./index.js");
function say() {
  console.log(Array.prototype.join.call(arguments, " "));
}
var ps = ['1 + 2 * 3 - 4 / 8', '2 ** 3 ** 2', '-2 ** 2', '(1 + 2) * -3 % 5', 'x = y = 3; x * y', 'fact = fn(n) => n < 2 ? 1 : n * fact(n - 1); fact(12)', 'add = fn(a) => fn(b) => a + b; add(1)(2) + add("x")("y")', '[1, 2, [3, 4]][2][1]', '"a\\"b" + 1', 'a && b || !c', '1 < 2 == 2 > 1', 'c ? a : b ? 1 : 2', 'fib = fn(n) => n < 2 ? n : fib(n - 1) + fib(n - 2); fib(11)', 'loop = fn() => loop(); 1', 'nope', '1(2)', '1 +', '(1', '1 = 2', '@', '', '1e3 + .5', 'n = 0; inc = fn() => n = n + 1; inc() + inc() * inc()'];
for (var r = 0; r < 2; r++) ps.forEach(function (p, i) { try { var ast = lib.parse(p), s = new lib.Scope(); s.vars.a = r; s.vars.b = 'B'; s.vars.c = null; var v = lib.run(ast, s); say(r, i, lib.print(ast), '=', typeof v === 'function' ? 'fn' : JSON.stringify(v), s.steps.n, lib.print(lib.fold(ast))); } catch (e) { say(r, i, e.name, e.message); } });
