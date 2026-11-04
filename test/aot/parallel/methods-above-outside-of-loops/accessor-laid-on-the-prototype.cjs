// accessor laid on the prototype
const name = JSON.parse('"read"');
const hidden = () => globalThis.kept;
const above = o => Object.getPrototypeOf(o);
class Meter { read(x) { return "method " + x; } }
function once(m) { return m.read(1); }
const m = new Meter(); globalThis.kept = m;
const said = [once(m)]; let gets = 0;
Object.defineProperty(above(hidden()), name, { get() { gets++; return x => "got " + x; }, configurable: true });
said.push(once(m), once(m), gets);
console.log(said.join(" | "));
