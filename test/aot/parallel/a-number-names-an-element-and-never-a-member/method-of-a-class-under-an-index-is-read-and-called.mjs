class A { x = 1; 0() { this.x = "text"; return 7; } }
const a = new A;
function get(o, i) { return o[i]; }
const f = get(a, [].length);
console.log(typeof f, f.call(a), typeof a.x);
