class A { x = 1; }
class B { y = 1; 0 = "text"; }
const both = [new A, new B];
function get(h, i) { return h[i]; }
console.log(both.map(h => typeof get(h, [].length)).join());
