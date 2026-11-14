// Under: --aot-harden=proof-checks: every position of the turns laid out is held against the length of its list
"use strict";
const rounds = +process.argv[2] || 3; const said = [];
const show = l => Array.from(l, x => String(x)).join(" ") + "#" + l.length + "#" + Object.keys(l).length;
const upTo = (n, f) => { const l = []; for (let i = 0; i < n; i++) l.push(f(i)); return l; };
function shift(list, n) { for (let i = 0; i < n; i++) list[i] = list[i] + 1; return list.length; }
function spread(list, n) { for (let i = 0; i < n; i++) { const was = list[i]; list[i] = was === undefined ? -1 : was * 2; } return list.length; }
for (let t = 0; t < rounds; t++) { said.length = 0; for (const size of [0, 7, 8, 9, 16, 19, 20, 21, 40]) { const l = upTo(size, i => i); said.push(size, shift(l, 20), show(l)); const m = upTo(size, i => i); said.push(spread(m, 20), show(m)); } }
console.log(said.join("\n"));
