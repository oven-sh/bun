// Own value 0 of what is made (settled fulfilled) comes out by from entries.
class P { x = 1; }
const V = new P();
function use(e) { return typeof e; }
const m = (await Promise.allSettled([Promise.resolve(V)]))[0];
try { console.log(use(Object.values(Object.fromEntries(Object.entries(m)))[0])); } catch (error) { console.log(error.constructor.name); }
