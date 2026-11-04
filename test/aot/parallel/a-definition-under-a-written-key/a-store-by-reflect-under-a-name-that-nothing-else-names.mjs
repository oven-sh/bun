class P { v = 1; }
const o = { a: 1 };
const p = new P;
function act() { Reflect.set(o, "hiddenName", p); }
act();
const found = Object.values(o).pop();
found.v = "text";
console.log(typeof p.v, Object.keys(o).join());
