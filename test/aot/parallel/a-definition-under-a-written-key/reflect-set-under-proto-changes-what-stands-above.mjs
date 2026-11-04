class A { a = 1; m() { return "method"; } }
const o = new A;
function act() { Reflect.set(o, "__proto__", { m() { return "other"; } }); }
act();
console.log(o.m(), o instanceof A, Object.keys(o).join());
