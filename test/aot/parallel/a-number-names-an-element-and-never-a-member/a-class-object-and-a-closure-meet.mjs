class A { static x = 1; static get 0() { this.x = "text"; return 7; } }
function f() {}
function get(h, i) { return h[i]; }
console.log([f, A].map(h => get(h, [].length)).join(), typeof A.x);
