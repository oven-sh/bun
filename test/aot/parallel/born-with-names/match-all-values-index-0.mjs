// What lies under `index` of a match (match all) comes out by values and is used as what it is.
function find(re, text) { return re.exec(text); }
function byForIn(o, name) { let found; for (const k in o) { if (k === name) found = o[k]; } return found; }
function use(e) { return typeof e; }
const m = [..."xa".matchAll(/(?<n>a)/g)][0];
console.log(use(Object.values(m)[2]));
