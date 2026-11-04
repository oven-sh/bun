function f() {}
function g() {}
class P { v = 1; }
g[0] = new P;
function get(h, i) { return h[i]; }
const found = [f, g].map(h => get(h, [].length));
found[1].v = "text";
console.log(typeof found[0], typeof found[1], typeof g[0].v);
