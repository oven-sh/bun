// Own value 0 of what is made (bound) comes out by from entries.
function use(e) { return typeof e; }
const m = (function named(a) {}).bind(null);
try { console.log(use(Object.values(Object.fromEntries(Object.entries(m)))[0])); } catch (error) { console.log(error.constructor.name); }
