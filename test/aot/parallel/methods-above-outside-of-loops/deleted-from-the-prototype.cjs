// deleted from the prototype
const name = JSON.parse('"read"');
const hidden = () => globalThis.kept;
const above = o => Object.getPrototypeOf(o);
class Base { read(x) { return "base " + x; } }
class Meter extends Base { read(x) { return "meter " + x; } }
function once(m) { return m.read(1); }
const m = new Meter(); globalThis.kept = m;
const said = [once(m)];
delete above(hidden())[name];
said.push(once(m));
delete above(above(hidden()))[name];
try { said.push(once(m)); } catch (e) { said.push(e.constructor.name); }
console.log(said.join(" | "));
