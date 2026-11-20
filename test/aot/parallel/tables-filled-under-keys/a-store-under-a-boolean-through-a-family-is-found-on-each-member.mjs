class Item { constructor(v) { this.v = v; } }
class Base { constructor() { this.id = 0; } }
class A extends Base {} class B extends Base {} class C extends Base {} class D extends Base {} class E extends Base {} class F extends Base {}
const flags = JSON.parse("[1, 0, 2, 5]"), all = [new A(), new B(), new C(), new D(), new E(), new F()];
function put(any, k, v) { any[!!k] = new Item(v); }
function read(x) { return x.v; }
for (let i = 0; i < all.length; i++) put(all[i], flags[0], i);
const c = all[flags[2]], held = c.true, before = read(held);
all[flags[3]].true.v = "five"; c[!!flags[0]].v = "text";
console.log(before, read(held), typeof read(all[5].true), read(all[0].true), Object.keys(c).join());
