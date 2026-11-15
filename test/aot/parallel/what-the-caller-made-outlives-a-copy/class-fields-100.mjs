function words(v) { try { return String(v); } catch (e) { return "no text: " + e.constructor.name; } }
function calculate(v) { try { return [v + 1, v * 2, v | 0, -v, v < 2, v == 1, v === 1].map(words).join(" "); } catch (e) { return "threw " + e.constructor.name; } }
function show(label, v) { console.log(label, typeof v, calculate(v), words(v), v === undefined, v === null); }
function read(o) { return o.x; }
function both(o) { return o.x + o.y; }
function keyed(o, k) { return o[k]; }
class Kind { x = 1; y = 2; }
function make() { return new Kind(); }
const o = make(), other = make();
show("before", read(o)); show("before, both", both(o));
try {
for (const e of (function* () { yield o; })()) e.x = "s";
} catch (e) { console.log("threw", e.constructor.name); }
show("after", read(o)); show("straight", o.x); show("by a key", keyed(o, "x")); show("both", both(o)); show("y", o.y);
show("the other", read(other)); show("made later", read(make()));
if (typeof o.sum === "function") show("by a method", o.sum());
const { x: taken } = o; show("taken apart", taken);
console.log("x" in o, Object.hasOwn(o, "x"), Object.keys(o).join(), words(JSON.stringify(o, (k, v) => typeof v === "bigint" || typeof v === "function" ? words(v) : k && v === o ? "itself" : v)), Object.getOwnPropertyNames(o).join());
let sum = 0; for (let turn = 0; turn < 3; turn++) { const v = read(o); sum = sum + v; } show("summed in a loop", sum);
delete Object.prototype.x;
