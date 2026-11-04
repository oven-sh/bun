// Own value 0 of what is made (group by) comes out by from entries.
class P { x = 1; }
const V = new P();
function use(e) { return typeof e; }
const m = Object.groupBy([V, V], (x, i) => (i ? "a" : "b"));
try { console.log(use(Object.values(Object.fromEntries(Object.entries(m)))[0])); } catch (error) { console.log(error.constructor.name); }
