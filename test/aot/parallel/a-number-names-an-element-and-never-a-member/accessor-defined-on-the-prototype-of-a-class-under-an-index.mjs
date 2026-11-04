class A { x = 1; }
Object.defineProperty(A.prototype, 0, { get() { this.x = "text"; return 7; } });
const a = new A;
function get(o, i) { return o[i]; }
console.log(typeof a.x, get(a, [].length), typeof a.x);
