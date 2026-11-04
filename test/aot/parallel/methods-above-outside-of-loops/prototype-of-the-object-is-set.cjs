// prototype of the object is set
const name = JSON.parse('"read"');
const hidden = () => globalThis.kept;
const above = o => Object.getPrototypeOf(o);
class Meter { read(x) { return "meter " + x; } }
function once(m) { return m.read(1); }
const a = new Meter(), b = new Meter(); globalThis.kept = b;
Object.setPrototypeOf(hidden(), { read(x) { return "set " + x; } });
console.log(once(a), "|", once(b));
Object.setPrototypeOf(hidden(), null);
try { console.log(once(b)); } catch (e) { console.log(e.constructor.name); }
