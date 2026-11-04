// frozen object
class Meter { constructor() { this.n = 3; } read(x) { return this.n + x; } }
function once(m) { return m.read(1); }
const m = Object.freeze(new Meter()); globalThis.kept = m;
console.log(once(m), once(new Meter()), Object.isFrozen(m));
