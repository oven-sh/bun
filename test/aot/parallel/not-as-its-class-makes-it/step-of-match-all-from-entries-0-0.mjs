// Own value 0 of what is made (step of match all) comes out by from entries.
function use(e) { return typeof e; }
const m = "xa".matchAll(/(a)/g).next();
try { console.log(use(Object.values(Object.fromEntries(Object.entries(m)))[0])); } catch (error) { console.log(error.constructor.name); }
