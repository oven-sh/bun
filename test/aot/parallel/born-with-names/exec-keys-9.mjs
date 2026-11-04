// The own keys of a match (exec).
function find(re, text) { return re.exec(text); }
function byForIn(o, name) { let found; for (const k in o) { if (k === name) found = o[k]; } return found; }
function countForIn(o) { let n = 0; for (const k in o) n++; return n; }
const m = /(?<n>a)/.exec("xa");
console.log(Object.keys({ ...m }).join());
