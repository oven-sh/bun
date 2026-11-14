// `list.push(a, ...other)`: the list is its own source: what it held in front of the call is appended once.
function twice(n) { const x = []; for (let i = 0; i < n; i++) x.push(i); x.push(...x); return x; }
function withOne(n) { const x = []; for (let i = 0; i < n; i++) x.push(i); x.push("s", ...x); x.push(...x, "e"); return x; }
for (const n of [0, 1, 2, 5, 40]) console.log(n, twice(n).length, JSON.stringify(twice(n).slice(0, 8)), withOne(n).length, JSON.stringify(withOne(n).slice(-5)));
