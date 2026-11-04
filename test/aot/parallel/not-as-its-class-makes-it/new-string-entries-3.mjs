// A character comes out of the object that stands for a text (new string) by entries.
function boxed(t) { return new String(t); }
function at(o, i) { return o[i]; }
function firstOf(o) { for (const c of o) return c; }
function byForIn(o) { let found; for (const k in o) found = o[k]; return found; }
function lastSeen(o) { let seen; Array.prototype.forEach.call(o, c => { seen = c; }); return seen; }
function use(e) { return e == null; }
const m = new String("ab");
try { console.log(use(Object.entries(m)[0][1])); } catch (error) { console.log(error.constructor.name); }
