// What lies under `groups` of a match (symbol match) comes out by values and is used as what it is.
function find(re, text) { return re.exec(text); }
function byForIn(o, name) { let found; for (const k in o) { if (k === name) found = o[k]; } return found; }
function use(e) { return e.n; }
const m = /(?<n>a)/[Symbol.match]("xa");
console.log(use(Object.values(m)[4]));
