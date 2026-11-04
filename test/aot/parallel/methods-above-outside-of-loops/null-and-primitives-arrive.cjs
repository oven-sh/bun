// null and primitives arrive
class Meter { read(x) { return "meter " + x; } }
function once(m) { return m.read(1); }
globalThis.kept = [null, undefined, 5, "text"];
const said = [once(new Meter())];
globalThis.kept.forEach(v => { try { said.push(once(v)); } catch (e) { said.push(e.constructor.name); } });
console.log(said.join(" | "));
