class Shape {
  get area() { return 7; }
  side() { return 3; }
  static get kind() { return "shape"; }
  static make() { return new Shape(); }
}
const part = globalThis.never ? "x" : "a";
const proxy = new Proxy(new Shape(), {}); console.log(proxy.area, proxy[part + "rea"]);
