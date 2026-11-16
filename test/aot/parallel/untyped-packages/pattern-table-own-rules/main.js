// An untyped package and a program of it (own rules): a table of expressions tried in turn; the groups of the first that matches are copied by index, upward and downward
const lib = require("./index.js");
function say() {
  console.log(Array.prototype.join.call(arguments, " "));
}
var rules = [{ name: 'a', re: /(a+)(b+)?(c)?/, keys: ['a', 'b', 'c'] }, { name: 'n', re: /(\d)(\d)?(\d)?(\d)?(\d)?/, keys: ['p', 'q', 'r', 's', 't'] }, { name: 'q', re: /"([^"]*)"|'([^']*)'|`([^`]*)`/, keys: ['double', 'single', 'back'] }];
for (var i = 0; i < 40; i++) {
  var t = ['xaab' + i, 'aaabbbc', String(i * 37), '"say ' + i + '"', "it's 'q" + i + "'", '`' + i, '`' + i + '`', 'none'][i % 8], m = lib.match(t, rules);
  say(i, t, m && m.rule, m && JSON.stringify(m.groups), m && m.down.join(), m && m.index, lib.longest(t, i % 2 ? rules : lib.rules));
}
