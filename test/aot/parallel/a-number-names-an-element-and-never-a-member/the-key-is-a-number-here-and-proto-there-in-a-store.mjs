class A { x = 1; m() { return "method"; } }
const a = new A;
function put(h, k, v) { h[k] = v; }
put(a, [].length, 1);
put(a, "__proto__", { m() { return "other"; } });
console.log(a.m(), a instanceof A, Object.keys(a).join());
