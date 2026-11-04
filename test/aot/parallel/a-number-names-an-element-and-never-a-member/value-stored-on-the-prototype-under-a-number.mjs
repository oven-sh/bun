function A() { this.x = 1; }
class P { v = 1; }
function put(o, i, v) { o[i] = v; }
put(A.prototype, [].length, new P);
const a = new A;
const found = a[0];
found.v = "text";
console.log(typeof found, typeof A.prototype[0].v);
