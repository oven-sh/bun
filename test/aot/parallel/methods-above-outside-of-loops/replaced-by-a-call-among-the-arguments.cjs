// replaced by a call among the arguments
const name = JSON.parse('"read"');
const hidden = () => globalThis.kept;
const above = o => Object.getPrototypeOf(o);
class Meter { read(x) { return "first " + x; } }
globalThis.swap = function () { above(hidden())[name] = function (x) { return "swapped " + x; }; return 7; };
function once(m, f) { return m.read(f()); }
const m = new Meter(); globalThis.kept = m;
console.log(once(m, () => 1), "|", once(m, globalThis.swap), "|", once(m, () => 2));
