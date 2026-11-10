class Item { constructor(v) { this.v = v; } }
class Base { constructor() { this.id = 0; } }
class A extends Base {} class B extends Base {} class C extends Base {} class D extends Base {} class E extends Base {} class F extends Base {}
const flags = JSON.parse("[1, 0, 2, 5]"), all = [new A(), new B(), new C(), new D(), new E(), new F()];
const table = new C();
function put(k, v) { table[!!k] = new Item(v); }
function get(k) { const found = table[!!k]; return found ? found.v : -1; }
function change(any, text) { const found = any.true; if (found) found.v = text; return any.id; }
function call(any) { return any.false ? 1 : 0; }
put(flags[0], 5); put(flags[1], 6);
const before = get(1) + get(0);
let sum = 0;
for (let i = 0; i < all.length; i++) sum += change(all[i], "no") + call(all[i]);
all[flags[2]] = table;
for (let i = 0; i < all.length; i++) sum += change(all[i], "text") + call(all[i]);
console.log(before, sum, get(flags[0]), typeof get(flags[3]), get(flags[1]));
