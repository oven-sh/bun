class Parent {
  constructor(level) {
    this.level = level;
  }
}
function withSetter(Base) {
  return class extends Base {
    set level(value) {
      this.kept = value * 2;
    }
  };
}
let sum = 0;
for (let i = 1; i < 4; i++) {
  const o = new (withSetter(Parent))(i);
  sum = sum * 10 + Object.keys(o).length * 100 + (o.kept === undefined ? 0 : o.kept) + (o.level === undefined ? 0 : 50);
  const p = new Parent(i);
  sum = sum * 10 + Object.keys(p).length * 100 + p.level;
  sum %= 1000003;
}
console.log(sum);
