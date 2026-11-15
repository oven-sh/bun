class A { static x = 1; static get 0() { this.x = "text"; return 7; } }
function get(h, i) { return h[i]; }
console.log(typeof A.x, get(A, [].length), typeof A.x);
