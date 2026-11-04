class A { get 1() { this.x = "text"; return 7; } }
class B extends A { x = 1; }
const b = new B;
function get(o, i) { return o[i]; }
console.log(typeof b.x, get(b, [0].length), typeof b.x);
