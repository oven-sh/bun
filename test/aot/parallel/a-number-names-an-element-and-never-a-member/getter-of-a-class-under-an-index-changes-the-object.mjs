class A { x = 1; get 0() { this.x = "text"; return 7; } }
const a = new A;
function get(o, i) { return o[i]; }
const before = typeof a.x;
const got = get(a, [].length);
console.log(before, got, typeof a.x);
