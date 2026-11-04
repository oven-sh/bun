// What lies under `index` of a match (exec) comes out by for in and is used as what it is.
function find(re, text) { return re.exec(text); }
function byForIn(o, name) { let found; for (const k in o) { if (k === name) found = o[k]; } return found; }
function use(e) { return typeof e; }
const m = /(?<n>a)/.exec("xa");
console.log(use(byForIn(m, "index")));
