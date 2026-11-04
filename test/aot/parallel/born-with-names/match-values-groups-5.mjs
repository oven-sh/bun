// What lies under `groups` of a match (match) comes out by values and is used as what it is.
function find(re, text) { return re.exec(text); }
function byForIn(o, name) { let found; for (const k in o) { if (k === name) found = o[k]; } return found; }
function use(e) { return Object.getPrototypeOf(e) === null; }
const m = "xa".match(/(?<n>a)/);
console.log(use(Object.values(m)[4]));
