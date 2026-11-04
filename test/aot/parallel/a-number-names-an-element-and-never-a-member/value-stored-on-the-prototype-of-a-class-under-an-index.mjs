class A { x = 1; }
class P { v = 1; }
A.prototype[0] = new P;
const a = new A;
function get(o, i) { return o[i]; }
const found = get(a, [].length);
found.v = "text";
console.log(typeof found, typeof A.prototype[0].v);
