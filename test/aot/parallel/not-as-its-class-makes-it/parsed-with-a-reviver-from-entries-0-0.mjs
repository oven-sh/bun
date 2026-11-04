// Own value 0 of what is made (parsed with a reviver) comes out by from entries.
class P { x = 1; }
const V = new P();
function use(e) { return typeof e; }
const m = JSON.parse('{"a":1,"b":"x"}', (k, v) => (k === "a" ? V : v));
try { console.log(use(Object.values(Object.fromEntries(Object.entries(m)))[0])); } catch (error) { console.log(error.constructor.name); }
