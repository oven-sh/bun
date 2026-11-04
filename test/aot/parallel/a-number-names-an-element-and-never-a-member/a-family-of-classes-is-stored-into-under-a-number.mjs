class A { x = 1; }
class B extends A { 0 = 5; }
class C extends A { set 0(v) { this.x = v; } }
const all = [new A, new B, new C];
function put(h, i, v) { h[i] = v; }
for (const h of all) put(h, [].length, "text");
console.log(all.map(h => typeof h[0] + typeof h.x).join());
