function define(k) {
  return class Item {
    static made = 0;
    constructor(v) {
      this.v = v;
      Item.made++;
    }
    get() {
      return this.v * k;
    }
    kind() {
      return "k" + k;
    }
  };
}
const A = define(2),
  B = define(3);
const items = [new A(1), new B(2), new A(3)];
function total() {
  let text = "";
  for (let i = 0; i < 3; i++) for (const item of items) text += item.get() + item.kind() + (item instanceof A) + " ";
  return text;
}
console.log(total(), A.made, B.made);
B.prototype.get = () => "b";
console.log(total());
const C = define(5);
items.push(new C(1));
C.prototype.kind = () => "c";
delete A.prototype.get;
A.prototype.get = () => "a";
console.log(total());
class Plain {
  m() {
    return 1;
  }
  static {
    this.prototype.m = () => 2;
  }
  n() {
    return this.m();
  }
}
console.log(new Plain().n(), new Plain().m());
