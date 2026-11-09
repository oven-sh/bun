// method holds captures
function make(tag) { return class Meter { read(x) { return tag + " " + x; } }; }
const A = make("a"), B = make("b");
function once(m) { return m.read(1); }
globalThis.kept = [new A(), new B()];
console.log(once(globalThis.kept[0]), "|", once(globalThis.kept[1]), "|", once(new A()));
