class A { a = 1; set x(v) { this.a = v; } }
const o = new A;
function act() { Reflect.set(o, "x", "text"); }
act();
console.log(typeof o.a, Object.keys(o).join());
