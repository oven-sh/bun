// An untyped package and a program of it (replaces): an expression engine by hand: parsed to a tree, compiled to instructions, run by backtracking threads with captures
const lib = require("./index.js");
function say() {
  console.log(Array.prototype.join.call(arguments, " "));
}
const r1 = new lib('(\\w)(\\d)?'), r2 = new lib('x*'), r3 = new lib('(?<a>[aeiou])(?<b>[^aeiou ])?', 'i'); for (let i = 0; i < 16; i++) { const t = ['a1 b2 c', 'axxb' + i, 'Hello World ' + i, ''][i % 4]; say(i, JSON.stringify(r1.replace(t, '<$2$1>')), JSON.stringify(r2.replace(t, '-')), JSON.stringify(r3.replace(t, (m, a, b, at) => a.toUpperCase() + (b || '_') + at)), JSON.stringify(r3.exec(t)?.named ?? null), t.replace(/(\w)(\d)?/g, '<$2$1>') === r1.replace(t, '<$2$1>'), t.replace(/x*/g, '-') === r2.replace(t, '-')); } try { new lib('(a*)*b(a*)*c').exec('a'.repeat(24)); say('ended'); } catch (e) { say(e.name, e.message); }
