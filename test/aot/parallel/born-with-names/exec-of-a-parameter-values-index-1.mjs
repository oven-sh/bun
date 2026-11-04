// What lies under `index` of a match (exec of a parameter) comes out by values and is used as what it is.
function find(re, text) { return re.exec(text); }
function byForIn(o, name) { let found; for (const k in o) { if (k === name) found = o[k]; } return found; }
function use(e) { return e + 1; }
const m = find(/(?<n>a)/, "xa");
console.log(use(Object.values(m)[2]));
