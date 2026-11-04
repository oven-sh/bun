// Own value 0 of what is made (step of a text) comes out by from entries.
function use(e) { return typeof e; }
const m = "ab"[Symbol.iterator]().next();
try { console.log(use(Object.values(Object.fromEntries(Object.entries(m)))[0])); } catch (error) { console.log(error.constructor.name); }
