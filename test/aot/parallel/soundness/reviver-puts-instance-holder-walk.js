// JSON.parse goes into what the reviver has put into the holder while an earlier key was visited: it deletes where the reviver answers undefined and defines what it answers else. Here an instance of a class.
function attempt(f) { try { return f(); } catch (e) { return "threw " + e.constructor.name; } }
class A { ga = { qb: 1 }; gb = { qb: 2 }; gc = { qb: 3 }; gd = 1.5; }
const deleted = new A();
JSON.parse('{"a":1,"b":2}', function (k, v) { if (k === "a") this.b = deleted; return k === "ga" ? undefined : v; });
console.log(attempt(() => deleted.ga.qb), attempt(() => deleted.gb.qb), Object.keys(deleted).join());
const defined = new A();
JSON.parse('{"a":1,"b":2}', function (k, v) { if (k === "a") this.b = defined; return k === "gb" ? 7 : k === "gd" ? "text" : v; });
console.log(attempt(() => defined.ga.qb), attempt(() => defined.gb.qb), attempt(() => defined.gd + 1), Object.keys(defined).join(), typeof defined.gb);
const untouched = new A();
console.log(untouched.ga.qb + untouched.gb.qb + untouched.gc.qb + untouched.gd);
