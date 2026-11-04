function A() { this.x = 1; }
Object.defineProperties(A.prototype, { name: { get() { return "n"; } }, 0: { get() { this.x = "text"; return 7; } } });
const a = new A;
function get(o, i) { return o[i]; }
console.log(typeof a.x, get(a, [].length), typeof a.x, a.name);
