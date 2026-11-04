class A { x = 1; }
class B extends A { 0 = "text"; }
class C extends A { 0 = 5; }
const all = [new A, new B, new C];
function get(h, i) { return h[i]; }
console.log(all.map(h => typeof get(h, [].length)).join());
