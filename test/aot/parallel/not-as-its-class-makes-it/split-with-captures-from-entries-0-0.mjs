// Own value 0 of what is made (split with captures) comes out by from entries.
function use(e) { return typeof e; }
const m = "a1b".split(/(\d)|(x)/);
try { console.log(use(Object.values(Object.fromEntries(Object.entries(m)))[0])); } catch (error) { console.log(error.constructor.name); }
