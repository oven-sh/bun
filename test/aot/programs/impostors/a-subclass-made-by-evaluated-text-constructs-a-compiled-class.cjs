class Base {
  x = 1;
  constructor(y) {
    this.y = y;
  }
  sum() {
    return this.x + this.y + (this.z === undefined ? 0 : this.z);
  }
}
class Middle extends Base {
  m = "m";
  constructor(y) {
    super(y);
    this.n = y * 2;
  }
}

let total = 0;
for (let i = 0; i < 100; i++) total += new Base(i).sum() + new Middle(i).sum();
console.log("total", total);

const makeSubclass = (0, eval)("(function (Parent) { return class Late extends Parent { z = 100; constructor(y) { super(y); this.late = true; } sum() { return 'late ' + super.sum(); } }; })");
for (const parent of [Base, Middle]) {
  const Late = makeSubclass(parent);
  for (let round = 0; round < 3; round++) {
    const o = new Late(round);
    console.log(parent.name, Object.keys(o).join(), o.x, o.y, o.z, o.m, o.n, o.late, o.sum(), o instanceof Late, o instanceof Base, o instanceof Middle, Object.getPrototypeOf(o) === Late.prototype);
  }
}
const Returns = new Function("Parent", "return class extends Parent { constructor() { return super(1), { replaced: true }; } }")(Base);
console.log(Object.keys(new Returns()).join());
