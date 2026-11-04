class Shape {
  get area() { return 7; }
  side() { return 3; }
  static get kind() { return "shape"; }
  static make() { return new Shape(); }
}
const proxy = new Proxy({}, { get(target, name) { return Reflect.get(new Shape(), name); } }); console.log(proxy.area);
