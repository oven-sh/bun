// A literal lays a getter in the place of a field, and through a name that the compiler cannot follow the property gets another getter, becomes a value, loses its getter, and goes.
type Cart = { count: number; readonly total: number };
function make(count: number): Cart {
  return {
    count,
    get total() {
      return this.count * 2;
    },
  };
}
function read(cart: Cart) {
  return cart.total;
}
function deed(how: number): Cart {
  (globalThis as any).held = make(3);
  const o = (globalThis as any).held;
  if (how === 0) Object.defineProperty(o, "total", { get: () => "other" });
  if (how === 1) Object.defineProperty(o, "total", { value: "plain", writable: true });
  if (how === 2) Object.defineProperty(o, "total", { get: undefined, set() {} });
  if (how === 3) delete o.total;
  if (how === 4) {
    delete o.total;
    o.total = "again";
  }
  return o;
}
console.log(read(make(1)), read(make(2)));
for (let how = 0; how < 6; how++) console.log(how, String(read(deed(how))));
let last = "";
for (let i = 0; i < 300; i++) last = String(read(i % 2 ? make(i) : deed(i % 6)));
console.log(last);
