class Base {
  tag = 7;
  constructor(x) {
    this.x = x;
  }
}
class Derived extends Base {
  label = "d";
  constructor(x, y) {
    super(x);
    this.y = y;
  }
}
class Further extends Derived {
  constructor(x) {
    super(x, x + 1);
    this.z = x + 2;
  }
}
globalThis.Escaped = Derived;
globalThis.EscapedBase = Base;

function show(label) {
  for (let i = 0; i < 3; i++) {
    const d = new Derived(i, i + 1);
    const f = new Further(i);
    console.log(label, Object.keys(d).join(), d.x, d.y, d.tag, d.other, d instanceof Base, "|", Object.keys(f).join(), f.x, f.y, f.z, f.tag, f.other, f instanceof Base);
  }
}
let total = 0;
for (let i = 0; i < 2000; i++) total += new Derived(i, 1).x + new Further(i).z;
console.log("total", total);
show("as written");
(0, eval)("Object.setPrototypeOf(Escaped, class Stranger { constructor(x) { this.other = 'stranger ' + x; } })");
show("another parent");
(0, eval)("Object.setPrototypeOf(Escaped, EscapedBase)");
show("the first parent again");
(0, eval)("Object.setPrototypeOf(Escaped, function Old(x) { this.other = 'old ' + x; })");
show("a function as parent");
(0, eval)("Object.setPrototypeOf(Escaped, function Returns(x) { return { replaced: x }; })");
show("a parent that returns another object");
