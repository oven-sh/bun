// replaced on the prototype between two calls
const name = JSON.parse('"read"');
const hidden = () => globalThis.kept;
const above = o => Object.getPrototypeOf(o);
class Meter { read(x) { return "first " + x; } }
function once(m, x) { return m.read(x); }
const m = new Meter(); globalThis.kept = m;
const said = [once(m, 1)];
above(hidden())[name] = function (x) { return "second " + x; };
said.push(once(m, 2));
console.log(said.join(" | "));
