// own property defined hides it
const name = JSON.parse('"read"');
const hidden = () => globalThis.kept;
const above = o => Object.getPrototypeOf(o);
class Meter { read(x) { return "above " + x; } }
function once(m) { return m.read(1); }
const a = new Meter(), b = new Meter(); globalThis.kept = b;
Object.defineProperty(hidden(), name, { value: x => "defined " + x, configurable: true });
console.log(once(a), "|", once(b));
delete hidden()[name];
console.log(once(b));
