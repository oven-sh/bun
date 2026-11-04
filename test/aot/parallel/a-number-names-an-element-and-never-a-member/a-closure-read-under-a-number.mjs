function f() {}
class P { v = 1; }
f[0] = new P;
function get(h, i) { return h[i]; }
const found = get(f, [].length);
found.v = "text";
console.log(typeof found, typeof f[0].v);
