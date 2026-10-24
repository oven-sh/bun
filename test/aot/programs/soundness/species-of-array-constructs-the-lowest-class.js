const log = [];
class A extends Array {
  static count = 0;
  constructor(...list) { super(...list); this.kind = this.describe(); new.target.count++; log.push(new.target.name + "(" + list.join() + ")"); }
  describe() { return "A"; }
}
class B extends A {
  extra = "x";
  describe() { return "B " + this.extra; }
}
function show(label, o) { console.log(label, o.constructor.name, o.kind, o.extra, o.length, Array.prototype.join.call(o), o instanceof B, Object.keys(o).join()); }
const b = B.from([1, 2, 3]);
show("from", b);
show("of", B.of(7, 8));
show("map", b.map(x => x * 2));
show("filter", b.filter(x => x > 1));
show("slice", b.slice(1));
show("concat", b.concat([9]));
show("flat", b.flat());
show("flatMap", b.flatMap(x => [x, x]));
show("splice", b.splice(0, 1));
show("after splice", b);
show("base", new A(1, 2));
console.log(A.count, B.count, Object.hasOwn(B, "count"), log.join(" "));
