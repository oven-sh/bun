class Other { constructor(n) { this.x = n; } }
class Heir extends Other {}
Object.defineProperty(Heir, Symbol.hasInstance, { value: (v) => { v.x = "text"; return false; } });
function sum(o) { return o.x + 1; }
const o = new Other(JSON.parse("1")), h = new Heir(JSON.parse("1"));
console.log(o instanceof Other, h instanceof Other, sum(o), sum(h), h instanceof Heir, sum(h));
