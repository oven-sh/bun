class A { x = 1; }
class B { y = 1; }
class C { z = 1; get 0() { this.z = "text"; return 7; } }
function get(h, i) { return h[i]; }
function pick(a, b, c, n) { return n === 0 ? a : n === 1 ? b : c; }
const c = new C;
const seen = [];
for (let n = 0; n < 3; n++) seen.push(get(pick(new A, new B, c, n), [].length));
console.log(seen.join(), typeof c.z);
