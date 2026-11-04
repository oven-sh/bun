// own property hides it
const name = JSON.parse('"read"');
const hidden = () => globalThis.kept;
const above = o => Object.getPrototypeOf(o);
class Meter { read(x) { return "above " + x; } }
function once(m) { return m.read(1); }
const a = new Meter(), b = new Meter(); globalThis.kept = b;
hidden()[name] = function (x) { return "own " + x; };
console.log(once(a), "|", once(b), "|", once(a));
