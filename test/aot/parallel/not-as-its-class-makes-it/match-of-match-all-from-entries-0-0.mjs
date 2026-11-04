// Own value 0 of what is made (match of match all) comes out by from entries.
function use(e) { return typeof e; }
const m = "xa".matchAll(/(a)/g).next().value;
try { console.log(use(Object.values(Object.fromEntries(Object.entries(m)))[0])); } catch (error) { console.log(error.constructor.name); }
