// a stranger arrives
class Meter { read(x) { return "meter " + x; } }
function once(m) { return m.read(1); }
globalThis.make = () => ({ read(x) { return "stranger " + x; } });
globalThis.kept = new Meter();
console.log(once(new Meter()), "|", once(globalThis.make()), "|", once(new Meter()));
