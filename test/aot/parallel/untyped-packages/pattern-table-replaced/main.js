// An untyped package and a program of it (replaced): a table of expressions tried in turn; the groups of the first that matches are copied by index, upward and downward
const lib = require("./index.js");
function say() {
  console.log(Array.prototype.join.call(arguments, " "));
}
var log = [], pats = [/(\w)(\d)?/g, /(?<year>\d{4})-(?<mon>\d\d)/g, /([aeiou])|([^aeiou\s])/gi];
for (var i = 0; i < 18; i++) {
  var t = ['abc1 d2', '2026-11 and 1999-0' + i % 10, 'Hello World ' + i][i % 3], re = pats[(i * 2) % 3], m, n = 0;
  re.lastIndex = 0;
  while ((m = re.exec(t)) && n++ < 9) { var s = ''; for (var k = m.length - 1; k >= 0; k--) s += (m[k] === undefined ? '.' : m[k]) + ','; log.push(s + m.index + (m.groups ? JSON.stringify(m.groups) : '')); }
  say(i, log.splice(0).join(' '));
  say(t.replace(re, function () { var a = [].slice.call(arguments), out = ''; for (var q = 0; q < a.length; q++) out += typeof a[q] === 'string' ? a[q].length : typeof a[q] === 'number' ? '#' + a[q] : a[q] ? '{' + Object.keys(a[q]) + '}' : '_'; return '<' + out + '>'; }));
}
