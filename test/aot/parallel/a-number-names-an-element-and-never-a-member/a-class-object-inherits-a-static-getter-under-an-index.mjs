class A { static get 0() { this.x = "text"; return 7; } }
class B extends A { static x = 1; }
function get(h, i) { return h[i]; }
console.log(typeof B.x, get(B, [].length), typeof B.x);
