// Own value 0 of what is made (boxed text) comes out by from entries.
function use(e) { return typeof e; }
const m = new String("ab");
try { console.log(use(Object.values(Object.fromEntries(Object.entries(m)))[0])); } catch (error) { console.log(error.constructor.name); }
