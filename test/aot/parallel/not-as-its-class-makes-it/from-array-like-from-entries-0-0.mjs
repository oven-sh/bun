// Own value 0 of what is made (from array like) comes out by from entries.
class P { x = 1; }
const V = new P();
function use(e) { return typeof e; }
const m = Array.from({ length: 2, 0: V });
try { console.log(use(Object.values(Object.fromEntries(Object.entries(m)))[0])); } catch (error) { console.log(error.constructor.name); }
