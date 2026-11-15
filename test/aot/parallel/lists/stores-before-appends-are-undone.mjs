// A loop pushes onto one literal, fills another under its counter, and then stores past the end. The store leaves the iteration, which takes back
// everything that the iteration has stored before the append as well.
// STATISTIC: IndexedStoresCompiledAsAppends >= 4
function fractions(n) { const l = [], m = []; for (let i = 0; i < n; i++) { l.push(i / 2); m[i] = l[i]; if (i === 2) l[4] = 1; } return [l, m]; }
function integers(n) { const l = [], m = []; for (let i = 0; i < n; i++) { l.push(i); m[i] = l[i]; if (i === 2) l[i + 2] = 1; } return [l, m]; }
function farther(n) { const l = [], m = []; for (let i = 0; i < n; i++) { l.push(i / 2); m[i] = l[i]; if (i === 2) l[i + 2] = 0.25; } return [l, m]; }
function counts(at) { const l = [], m = [], c = [0.5, 1.5]; for (let i = 0; i < 12; i++) { c[1]++; m[i] = c[0]; if (i === at) l[at + 3] = 1; } return [l, m, c]; }
function text(list) { let r = list.length + ":"; for (let i = 0; i < list.length; i++) r += (i in list ? Array.isArray(list[i]) ? text(list[i]) : list[i] : "hole") + ","; return r; }
for (const n of [2, 7, 12, 30]) {
  for (const f of [fractions, integers, farther]) console.log(f.name, n, text(f(n)));
}
for (const at of [0, 2, 5]) console.log("counts", at, text(counts(at)));
