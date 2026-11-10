// STATISTIC: LengthsHeldAgainstBoundInFrontOfTurnsLaidOut >= 1
// Under: --aot-harden=proof-checks: every position of the turns laid out is held against the length of its list
"use strict";
const rounds = +process.argv[2] || 3; const said = [];
const show = l => Array.from(l, x => String(x)).join(" ") + "#" + l.length + "#" + Object.keys(l).length;
const upTo = (n, f) => { const l = []; for (let i = 0; i < n; i++) l.push(f(i)); return l; };
function fromZero(from, into, n) { for (let i = 0; i < n; i++) into[i] = from[i]; return into.length; }
function fromOne(from, into, n) { for (let i = 1; i < n; i++) into[i] = from[i]; return into.length; }
function fromSeven(from, into, n) { for (let i = 7; i < n; i++) into[i] = from[i]; return into.length; }
for (let t = 0; t < rounds; t++) { said.length = 0; for (let n = 0; n < 35; n++) { const from = upTo(24, i => i + 100); let into = upTo(24, i => -i); said.push(n, fromZero(from, into, n), show(into)); into = upTo(24, i => -i); said.push(fromOne(from, into, n), show(into)); into = upTo(24, i => -i); said.push(fromSeven(from, into, n), show(into)); } }
console.log(said.join("\n"));
