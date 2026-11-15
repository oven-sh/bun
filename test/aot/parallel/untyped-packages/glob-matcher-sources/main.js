// An untyped package and a program of it (sources): wildcards to expressions, braces, negation, a cache
const lib = require("./index.js");
function say() {
  console.log(Array.prototype.join.call(arguments, " "));
}
for (var i = 0; i < 30; i++) { var p = ['a*', 'b?' + i, '**/c' + i % 4, '[0-' + i % 10 + ']', 'x{1,2,' + i + '}y'][i % 5], f = lib.make(p, i % 2 ? 'i' : ''); say(p, f.re.source, [p, 'abc', 'B' + i, 'q/c1', '5', 'x2y', 'X' + i + 'Y'].map(function (s) { return f(s) ? 1 : 0; }).join('')); }
say(lib.hits());
