// plain call
class Meter { constructor(n) { this.n = n; } read(x) { return this.n + x; } }
function once(m) { return m.read(1); }
globalThis.kept = new Meter(0);
console.log(once(new Meter(1)), once(new Meter(2)), once(globalThis.kept));
