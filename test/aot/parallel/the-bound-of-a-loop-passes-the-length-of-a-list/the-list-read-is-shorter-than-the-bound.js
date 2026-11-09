// STATISTIC: LengthsHeldAgainstBoundInFrontOfTurnsLaidOut >= 1
// Under: --aot-testing=EmittersAloneTestEveryPosition: the turns are laid out as users build them, and every raw access asks its position at the run
// Under: --aot-harden=proof-checks: every position of the turns laid out is held against the length of its list
"use strict";
const rounds = +process.argv[2] || 3; const said = [];
const show = l => Array.from(l, x => String(x)).join(" ") + "#" + l.length + "#" + Object.keys(l).length;
const upTo = (n, f) => { const l = []; for (let i = 0; i < n; i++) l.push(f(i)); return l; };
function copy(from, into, n) { for (let i = 0; i < n; i++) into[i] = from[i]; return into.length; }
function sum(from, n) { let s = 0; for (let i = 0; i < n; i++) s += from[i]; return s; }
for (let t = 0; t < rounds; t++) { said.length = 0; for (const short of [0, 1, 7, 8, 9, 15, 16, 17, 24]) { const from = upTo(24 - short, i => i * 3 + 1), into = upTo(24, i => -i); said.push(short, copy(from, into, 24), show(into), sum(from, 24), sum(from, 24 - short)); } }
console.log(said.join("\n"));
