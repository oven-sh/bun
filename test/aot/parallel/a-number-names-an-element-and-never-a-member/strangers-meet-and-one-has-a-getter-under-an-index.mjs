class A { x = 1; }
class B { y = 1; get 0() { this.y = "text"; return 7; } }
const both = [new A, new B];
function get(h, i) { return h[i]; }
console.log(both.map(h => get(h, [].length)).join(), typeof both[1].y);
