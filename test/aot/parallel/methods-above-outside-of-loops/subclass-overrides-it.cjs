// subclass overrides it
class Meter { read(x) { return "meter " + x; } }
class Fine extends Meter { read(x) { return "fine " + super.read(x); } }
function once(m) { return m.read(1); }
globalThis.kept = [new Meter(), new Fine()];
console.log(once(globalThis.kept[0]), "|", once(globalThis.kept[1]), "|", once(new Fine()), "|", once(new Meter()));
