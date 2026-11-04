// through a proxy
class Meter { read(x) { return "meter " + x + " " + (this instanceof Meter); } }
function once(m) { return m.read(1); }
const seen = [];
globalThis.kept = new Proxy(new Meter(), { get(t, k, r) { seen.push(String(k)); return Reflect.get(t, k, r); } });
console.log(once(new Meter()), "|", once(globalThis.kept), "|", seen.join());
