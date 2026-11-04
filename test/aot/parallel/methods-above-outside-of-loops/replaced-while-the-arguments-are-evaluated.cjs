// replaced while the arguments are evaluated
const name = JSON.parse('"read"');
const hidden = () => globalThis.kept;
const above = o => Object.getPrototypeOf(o);
class Meter { read(x) { return "first " + x; } }
function other(x) { return "other " + x; }
function once(m, swap) { return m.read(swap ? (above(hidden())[name] = other, 1) : 0); }
const m = new Meter(); globalThis.kept = m;
console.log(once(m, false), "|", once(m, true), "|", once(m, false));
