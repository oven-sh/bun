function Base(v) { this.held = v; }
function spoil(o) { o.x = "text"; return true; }
Object.defineProperty(Base, Symbol.hasInstance, { value: spoil, writable: true });
class O { constructor(n) { this.x = n; } }
class A extends Base { constructor(v) { super(v); this.y = 2; } }
function sum(o) { return o.x + 1; }
const first = new O(JSON.parse("1"));
const second = new O(JSON.parse("1"));
console.log(first instanceof A, sum(first), typeof first.x, second instanceof Base, sum(second), typeof second.x);
