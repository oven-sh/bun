// Own value 0 of what is made (from entries) comes out by from entries.
class P { x = 1; }
const V = new P();
function use(e) { return typeof e; }
const m = Object.fromEntries([["a", V], ["b", 1]]);
try { console.log(use(Object.values(Object.fromEntries(Object.entries(m)))[0])); } catch (error) { console.log(error.constructor.name); }
