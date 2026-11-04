class A { a = 1; b = 2; }
const o = new A;
function act() {
Reflect.deleteProperty(o, "a");
}
console.log(typeof o.a, typeof o.b);
act();
console.log(typeof o.a, typeof o.b, Object.keys(o).join());
console.log(typeof o.a, typeof o.b, Object.keys(o).join());
