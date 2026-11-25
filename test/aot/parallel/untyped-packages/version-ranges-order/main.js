// An untyped package and a program of it (order): versions parsed by one expression; ranges by a table of rewrites, comparators and or-lists
const lib = require("./index.js");
function say() {
  console.log(Array.prototype.join.call(arguments, " "));
}
const list = ['1.0.0', '1.0.0-alpha', '1.0.0-alpha.1', '1.0.0-alpha.beta', '1.0.0-beta', '1.0.0-beta.2', '1.0.0-beta.11', '1.0.0-rc.1', '2.1.0', '2.1.1', '10.0.0', '2.0.0', '1.0.0+b1', '0.9.12', '1.0.0-0', '1.0.0-1.a'];
say(list.slice().sort(lib.compare).join(' ')); say(list.map((a, i) => list.map((b, k) => '<=>'[lib.compare(a, b) + 1]).join('')).join(' '));
for (let i = 0; i < 24; i++) { const v = new lib.Version(list[i % list.length]); say(i, v.inc(['major', 'minor', 'patch', 'pre', 'pre', 'other'][i % 5], i % 3 ? undefined : 'rc').toString(), v.numbers.join('/'), JSON.stringify(v.pre), v.build, `${v}`); }
try { new lib.Version('1.0.0').inc('other'); } catch (e) { say(e.message); }
