const log = [];
class A extends Uint8Array {
  constructor(...list) { super(...list); this.kind = this.describe(); log.push(new.target.name + ":" + list.length); }
  describe() { return "A"; }
}
class B extends A {
  extra = "x";
  describe() { return "B " + this.extra; }
}
function show(label, o) { console.log(label, o.constructor.name, o.kind, o.extra, o.length, Array.prototype.join.call(o), o instanceof B); }
const b = B.from([1, 2, 3]);
show("from", b);
show("of", B.of(4, 5));
show("map", b.map(x => x * 2));
show("filter", b.filter(x => x > 1));
show("slice", b.slice(1));
show("subarray", b.subarray(1));
show("base", new A(2));
class BaseBuffer extends ArrayBuffer {
  constructor(n) { super(n); this.kind = this.describe(); log.push(new.target.name); }
  describe() { return "BaseBuffer"; }
}
class LowerBuffer extends BaseBuffer { extra = "y"; describe() { return "LowerBuffer " + this.extra; } }
const s = new LowerBuffer(8).slice(2);
console.log(s.constructor.name, s.kind, s.extra, s.byteLength, s instanceof LowerBuffer);
console.log(log.join());
