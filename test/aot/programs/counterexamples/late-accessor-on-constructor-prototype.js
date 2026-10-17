// An accessor is defined late on the prototype of a constructor function, under a name that the constructor stores to: the setter runs and the object has no such property of its own.
function P(a, b) { this.x = a; this.y = b; }
const seen = [];
const see = o => seen.push(Object.keys(o).join() + "|" + String(o.x) + "|" + String(o.y));
see(new P(1, "s"));
Object.defineProperty(P.prototype, "x", { set(v) { seen.push("setter " + v); }, get() { return "got"; }, configurable: true });
try { see(new P(2, "m")); } catch (e) { seen.push("THROWS " + e.name + ": " + e.message); }
console.log(seen.join(" ; "));
