class A { x = 1; }
const a = new A;
Object.defineProperty(a, 0, { get() { this.x = "text"; return 7; } });
function get(o, i) { return o[i]; }
console.log(typeof a.x, get(a, [].length), typeof a.x);
