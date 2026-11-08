// the receiver is read twice
const name = JSON.parse('"read"');
const hidden = () => globalThis.kept;
const above = o => Object.getPrototypeOf(o);
class Meter { constructor(n) { this.n = n; } read(x) { return this.n + x; } }
const box = { m: new Meter(1) }; globalThis.kept = box;
function once(b) { return b.m.read((hidden().m = new Meter(10), 1)) + b.m.read(1); }
console.log(once(box));
