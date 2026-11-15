// STATISTIC: LoopsReversionedForOtherIndexingType >= 1
// Under: --aot-harden=proof-checks: the kind found in front of the turns is held against the cell at every access
"use strict";
const rounds = +process.argv[2] || 3; const said = [];
const show = l => Array.from(l, x => Object.is(x, -0) ? "-0" : String(x)).join(" ") + "#" + l.length + "#" + Object.keys(l).length;
const small = n => { const l = new Array(n); for (let i = 0; i < n; i++) l[i] = i * 3; return l; };
const large = n => { const l = new Array(n); for (let i = 0; i < n; i++) l[i] = 1762400000000 + i * 1000; return l; };
const oneLarge = n => { const l = new Array(n); for (let i = 0; i < n; i++) l[i] = i === 9 ? 5000000000 : i; return l; };
const holed = n => { const l = new Array(n); for (let i = 0; i < n; i++) if (i !== 4 && i !== n - 1) l[i] = 4294967296 + i; return l; };
const holedSmall = n => { const l = new Array(n); for (let i = 0; i < n; i++) if (i !== 0) l[i] = i; return l; };
const minusZero = n => { const l = new Array(n); for (let i = 0; i < n; i++) l[i] = i === 3 ? -0 : -4294967296 * i; return l; };
function reverse(from, into, n) { for (let i = 0; i < n; i++) into[n - 1 - i] = from[i]; return into.length; }
function copy(from, into, n) { for (let i = 0; i < n; i++) into[i] = from[i]; return into.length; }
const makers = [small, large, oneLarge, holed, holedSmall, minusZero];
for (let t = 0; t < rounds; t++) { said.length = 0; for (const a of makers) for (const b of makers) for (const size of [20, 12]) { let into = b(size); said.push(a.name + " " + b.name + " " + size, reverse(a(20), into, 20), show(into)); into = b(size); said.push(copy(a(20), into, 20), show(into)); } for (const a of makers) { const l = a(20); said.push("the same list " + a.name, reverse(l, l, 20), show(l)); } }
console.log(said.join("\n"));
