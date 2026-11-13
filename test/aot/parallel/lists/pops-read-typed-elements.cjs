// Loops push numbers onto literals and pop them off again: the last element, empty literals, the place behind a pop, what else names the list.
function brackets(L) { const q = []; let s = 0; for (let i = 0; i < L.length; i++) { const x = L[i]; if (q.length > 0 && q[q.length - 1] > x) s += q.pop(); else q.push(x); } return s + ":" + q.join(); }
function storesBack(L) { const q = [3, 2, 1]; let i = 0; for (const x of L) { i++; q.push(1); if (x === q[q.length - 1]) q[q.length - 1] = q.pop(); } return q.join() + i; }
function storesBehind(L) { const q = [3, 2, 1]; for (let i = 0, m = L.length; i < m; ++i) { const x = L[i]; if (x === q[q.length - 1]) { const at = q.length - 1; q.pop(); q[at] = x + 1; } else q.push(i - 3); } return q.join(); }
function readsBehind(L) { const q = []; let t = ""; for (let i = 0; i < L.length; i++) { q.push(L[i]); if (q.length > 2) { const at = q.length - 1; q.pop(); t += q[at] + "|" + q[q.length - 1] + ","; } } return t; }
function popsPastEnd(L) { const q = []; let t = ""; for (let i = 0; i < L.length; i++) { if (L[i] > 2) q.push(L[i]); t += q.pop() + ","; } return t + q.length; }
function named(L) { const q = [], r = { q }; let s = 0; for (let i = 0; i < L.length; i++) { q.push(L[i]); if (q.length > 3) { s += q.pop(); s += r.q.length; } } return s + ":" + r.q.join(); }
function nearest(L) { const q = []; let t = ""; for (let i = 0; i < L.length; i++) { while (q.length && L[q[q.length - 1]] >= L[i]) q.pop(); t += (q.length ? q[q.length - 1] : -1) + ","; q.push(i); } return t; }
function grows(L) { const q = [0.5]; let s = 0; for (let i = 0; i < L.length * 9; i++) { q.push(L[i % L.length]); if (i % 3 === 0) s += q.pop(); if (i % 7 === 0 && q.length) q[q.length - 1] = i; } return s + ":" + q.length + ":" + q[q.length - 1]; }
function holes(L) { const q = []; for (let i = 0; i < L.length; i++) { q.push(L[i]); q.push(L[i] / 2); if (i % 2) q.pop(); } q.length += 2; return q.length + ":" + (q.length - 1 in q) + q.join(); }
const lists = [[5, 3, 8, 1, 2, 7, 7, 0], [1.5, 5, 3.25, 8, 2, 9.5, 4, 7, 6, 5, 3, 8.75, 1, 9, 5, 2.5], [], [0, 0, -0, 1, 1, 0.5, 0.5, 3], [1, 1, 1, 1], [5, "7", 3, null, 2, 9, undefined, 7], [NaN, 2, NaN, 4], [2147483647, -2147483648, 4294967296]];
for (const of of [brackets, storesBack, storesBehind, readsBehind, popsPastEnd, named, nearest, grows, holes]) {
  const lines = [];
  for (let turn = 0; turn < 40; turn++) { lines.length = 0; for (const list of lists) lines.push(of(list.slice())); }
  console.log(of.name, lines.join(" "));
}
