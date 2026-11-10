// STATISTIC: UnrolledLoopLengthChecksHoisted >= 1
// Under: --aot-harden=proof-checks: every position of the turns laid out is held against the length of its list
"use strict";
const rounds = +process.argv[2] || 3; const said = [];
const show = l => Array.from(l, x => String(x)).join(" ") + "#" + l.length + "#" + Object.keys(l).length;
const upTo = (n, f) => { const l = []; for (let i = 0; i < n; i++) l.push(f(i)); return l; };
function usual(from, into, n) { for (let i = 0; i < n; i++) into[i] = from[i]; return into.length; }
function inTheHead(from, into, n) { for (let i = 0; (into[i] = from[i], i < n); i++); return into.length; }
function inTheStep(from, into, n) { for (let i = 0; i < n; i++, into[i] = from[i]); return into.length; }
function behindContinue(from, into, n) { for (let i = 0; i < n; i++) { if (from[i] & 1) continue; into[i] = from[i]; } return into.length; }
function doWhile(from, into, n) { let i = 0; do { into[i] = from[i]; i++; } while (i < n); return into.length; }
function endsLate(from, into, n) { for (let i = 0; i < n && from[i] !== 119; i++) into[i] = from[i]; return into.length; }
function countIsWritten(from, into, n) { for (let i = 0; i < n; i++) { into[i] = from[i]; if (from[i] === 105) i++; } return into.length; }
function boundIsWritten(from, into, n) { for (let i = 0; i < n; i++) { into[i] = from[i]; if (i === 3) n += 4; } return into.length; }
function upToAndWith(from, into, n) { for (let i = 0; i <= n; i++) into[i] = from[i]; return into.length; }
for (let t = 0; t < rounds; t++) { said.length = 0; for (const f of [usual, inTheHead, inTheStep, behindContinue, doWhile, endsLate, countIsWritten, boundIsWritten, upToAndWith]) for (let n = 14; n < 27; n++) { const from = upTo(24, i => i + 100), into = upTo(24, i => -i); said.push(f.name + " " + n, f(from, into, n), show(into)); } }
console.log(said.join("\n"));
