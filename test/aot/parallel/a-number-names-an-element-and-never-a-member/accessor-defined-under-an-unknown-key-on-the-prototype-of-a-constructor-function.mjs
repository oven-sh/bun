function A() { this.x = 1; }
function define(k) { Object.defineProperty(A.prototype, k, { get() { this.x = "text"; return 7; } }); }
define(String([].length));
const a = new A;
function get(o, i) { return o[i]; }
console.log(typeof a.x, get(a, [].length), typeof a.x);
