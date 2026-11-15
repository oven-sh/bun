// Flags: --aot-harden=proof-checks
// A capacity that is read before a pop is the capacity after it: a pop changes the length alone.
function parens(s) { const open = []; for (let i = 0; i < s.length; i++) { if (s[i] === "(") open.push(i); else if (s[i] === ")") open.pop(); } return open; }
function either(list) { const out = []; for (let i = 0; i < list.length; i++) { if (list[i] & 1) out.push(list[i]); else if (out.length > 2) out.pop(); } return out; }
function sums(list) { const out = []; let sum = 0; for (let i = 0; i < list.length; i++) { out.push(list[i]); if (list[i] % 3 === 0) sum += out.pop(); out.push(sum); } return out; }
function shifts(list) { const out = []; for (let i = 0; i < list.length; i++) { if (list[i] & 1) out.push(i); else if (list[i] === 4) out.shift(); else out.pop(); } return out; }
function cuts(list) { const out = []; for (let i = 0; i < list.length; i++) { out.push(list[i]); if (list[i] === 6) out.length = 0; else if (list[i] === 5) out.length >>= 1; } return out; }
function splices(list) { const out = []; for (let i = 0; i < list.length; i++) { out.push(list[i]); if (list[i] === 2) out.splice(1, 2); else if (list[i] === 7) out.pop(); } return out; }
function fronts(list) { const out = []; for (let i = 0; i < list.length; i++) { out.push(list[i]); if (list[i] === 2) out.unshift(i); else if (list[i] === 7) out.pop(); } return out; }
function sorts(list) { const out = []; for (let i = 0; i < list.length; i++) { out.push(list[i]); if (list[i] === 2) out.sort((a, b) => a - b); else if (list[i] === 7) out.pop(); } return out; }
function walks(edges, n) { const seen = [], stack = [0]; while (stack.length) { const at = stack.pop(); if (seen.includes(at)) continue; seen.push(at); for (let i = 0; i < edges.length; i++) if (edges[i] % n === at) stack.push(i % n); } return seen; }
function both(list) { const a = [], b = []; for (let i = 0; i < list.length; i++) { if (list[i] & 1) a.push(list[i]); else { b.push(a.length ? a.pop() : -1); } } return [a, b]; }
const list = n => Array.from({ length: n }, (_, i) => (i * 7 + (i >> 3)) % 11);
for (const s of ["(a", "(a(b)c(", "x)y(z", "", ")((", "((((((((((((((((((((".repeat(9) + ")"]) console.log(parens(s).length);
for (const n of [0, 1, 3, 5, 17, 18, 90, 400])
  console.log(n, [either, sums, shifts, cuts, splices, fronts, sorts, list => walks(list, 9), list => both(list).flat()].map(run => run(list(n))).map(out => out.length + ":" + out.slice(-4)).join(" "));
