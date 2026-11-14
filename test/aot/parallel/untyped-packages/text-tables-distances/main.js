// An untyped package and a program of it (distances): text wrapped, aligned, boxed; differences of lines; distances; cases; a rope that is built and cut
const lib = require("./index.js");
function say() {
  console.log(Array.prototype.join.call(arguments, " "));
}
var list = ['kitten', 'sitting', '', 'abc', 'acb', 'saturday', 'sunday', 'ab', 'ba', 'xabxcdxx', 'abcd']; list.forEach(function (a, i) { say(a, list.map(function (b) { return lib.distance(a, b) + '/' + lib.distance(a, b, true); }).join(' '), lib.lcs(a.split(''), list[(i + 1) % list.length].split('')).map(function (x) { return x.join(''); }).join('')); });
['fooBar baz', 'HTTPServer2Go', 'snake_case_here', 'kebab-case', 'Ünïcödé Text!', '  ', 'a1b2', 'XMLHttpRequest', 'ß straße'].forEach(function (s) { say(Object.keys(lib.cases).map(function (k) { return k + '=' + lib.cases[k](s); }).join(' | '), lib.words(s).join()); });
