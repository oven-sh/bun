// recursion through the method
const name = JSON.parse('"read"');
const hidden = () => globalThis.kept;
const above = o => Object.getPrototypeOf(o);
class Tree { constructor(l, r) { this.l = l; this.r = r; } read() { return 1 + (this.l ? this.l.read() : 0) + (this.r ? this.r.read() : 0); } }
const t = new Tree(new Tree(null, new Tree(null, null)), new Tree(new Tree(null, null), null));
globalThis.kept = t.l;
const before = t.read();
hidden()[name] = () => 100;
console.log(before, t.read());
