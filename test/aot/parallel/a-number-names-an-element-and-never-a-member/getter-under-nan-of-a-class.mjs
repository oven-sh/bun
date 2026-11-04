class A { x = 1; get NaN() { this.x = "text"; return 7; } }
const a = new A;
function get(o, i) { return o[i]; }
console.log(typeof a.x, get(a, [].length / [].length), typeof a.x);
