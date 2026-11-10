const say = x => { try { return JSON.stringify(x, (k, v) => v === undefined ? "undefined" : typeof v === "number" && !Number.isFinite(v) ? String(v) : typeof v === "function" ? "function " + v.name : v); } catch (e) { return String(e); } };

function fails(x) { if (x === 2) throw new RangeError("at " + x); return x; }
async function later(x) { return x; }
function* steps(x) { yield x; }
class Made { constructor(x) { this.x = x; } }
function run(list, which) { switch (which) { case 0: return list.map(fails); case 1: return list.map(later).length; case 2: return list.map(steps).map(first); case 3: return list.map(Made); default: return list.map(missing); } }
function first(it) { return it.next().value; }
for (let which = 0; which < 5; which++) { try { console.log(which, say(run([1, 2, 3], which))); } catch (e) { console.log(which, e.constructor.name, e.message); } }
try { console.log(say(run([], 3)), say(run([], 0))); } catch (e) { console.log(e.constructor.name); }
var missing;
