// An untyped package and a program of it (ranges): versions parsed by one expression; ranges by a table of rewrites, comparators and or-lists
const lib = require("./index.js");
function say() {
  console.log(Array.prototype.join.call(arguments, " "));
}
const ranges = ['^1.2.3', '~1.2', '1.x', '>=1.0.0 <2.0.0', '1.2.3 - 2.3', '*', '<1', '^0.0.3', '^0.2.x', '>1.2', '<=1', '~> 2', '1.2.3-beta.2 || ^3', '= 1.1.1', 'nonsense', '>=1.2.3-a.1'];
const versions = ['0.0.3', '0.0.4', '0.2.9', '1.0.0', '1.1.1', 'v1.2.3', '1.2.3-beta.2', '1.2.3-beta.10+build.5', '1.9.9', '2.0.0', '2.3.4', '3.0.0-rc.1', '3.1.0', '1.2', 'x'];
for (const r of ranges) { let R; try { R = new lib.Range(r); say(r, '=', R); } catch (e) { say(e.name, e.message); continue; } say(versions.map(v => { try { return R.test(v) ? 1 : 0; } catch (e) { return '!'; } }).join(''), lib.max(versions.slice(0, 13), r)); }
