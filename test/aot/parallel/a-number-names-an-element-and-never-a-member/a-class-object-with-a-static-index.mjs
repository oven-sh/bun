class A { static 0 = "text"; static x = 1; }
function get(h, i) { return h[i]; }
console.log(typeof get(A, [].length), typeof A.x);
