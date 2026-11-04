// Own value 0 of what is made (array of) comes out by from entries.
class P { x = 1; }
const V = new P();
function use(e) { return typeof e; }
const m = Array.of(V, 1);
try { console.log(use(Object.values(Object.fromEntries(Object.entries(m)))[0])); } catch (error) { console.log(error.constructor.name); }
