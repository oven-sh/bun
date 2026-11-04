class A { x = 1; get Infinity() { this.x = "text"; return 7; } }
const a = new A;
function get(o, i) { return o[i]; }
console.log(typeof a.x, get(a, 1 / [].length), typeof a.x);
