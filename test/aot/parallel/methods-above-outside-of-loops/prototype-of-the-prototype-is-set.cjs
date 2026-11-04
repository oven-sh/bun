// prototype of the prototype is set
const name = JSON.parse('"read"');
const hidden = () => globalThis.kept;
const above = o => Object.getPrototypeOf(o);
class Base { read(x) { return "base " + x; } }
class Meter extends Base {}
function once(m) { return m.read(1); }
const m = new Meter(); globalThis.kept = m;
const said = [once(m)];
Object.setPrototypeOf(above(hidden()), { read(x) { return "other " + x; } });
said.push(once(m));
console.log(said.join(" | "));
