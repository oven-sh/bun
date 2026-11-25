// An untyped package and a program of it (groups): functions with defaults, missing arguments and callbacks that take less or more than they are given
const lib = require("./index.js");
function say() {
  console.log(Array.prototype.join.call(arguments, " "));
}
const rows = Array.from({ length: 18 }, (_, i) => ({ k: ['x', 'y', 'constructor', 0][i % 4], n: i * 7 % 5, t: 't' + i % 3, i })); for (let i = 0; i < 8; i++) { const keys = [['n'], ['-n', 't'], [r => -r.i], ['k', '-i'], ['t', r => r.n % 2, '-i'], [], ['none', 'i'], ['-k', 'n', 'i']][i]; say(i, lib.sortBy(rows, ...keys).map(r => r.i).join(), JSON.stringify(lib.groupBy(rows.slice(i), i % 2 ? undefined : (r, at) => at % (i + 1))).length, Object.keys(lib.groupBy(rows, keys[0] && typeof keys[0] === 'string' ? keys[0].replace('-', '') : 't')).join(), lib.each(rows, r => r.i < i * 3), lib.each(rows, function (r, k) { return this.max > k; }, { max: i })); } const log = [], d = lib.debounceLog(function (s, n) { log.push(this.name + s + n); return s.length; }); for (let i = 0; i < 14; i++) { say(i, d.call({ name: 'c' + i }, ...[[], [i], [i, i + 1]][i % 3]), log.length); } say(log.join(' '));
