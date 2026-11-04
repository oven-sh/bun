// static method
const name = JSON.parse('"read"');
const hidden = () => globalThis.kept;
const above = o => Object.getPrototypeOf(o);
class Meter { static read(x) { return "static " + x; } }
function once(C) { return C.read(1); }
globalThis.kept = Meter;
const said = [once(Meter)];
hidden()[name] = x => "replaced " + x;
said.push(once(Meter));
console.log(said.join(" | "));
