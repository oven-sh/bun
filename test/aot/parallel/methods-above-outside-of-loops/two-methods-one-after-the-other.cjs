// two methods one after the other
const name = JSON.parse('"read"');
const hidden = () => globalThis.kept;
const above = o => Object.getPrototypeOf(o);
class Meter { first(x) { above(hidden())[JSON.parse('"second"')] = y => "swapped " + y; return "first " + x; } second(y) { return "second " + y; } }
function both(m) { return m.first(1) + " | " + m.second(2); }
const m = new Meter(); globalThis.kept = m;
console.log(both(m));
