class O { constructor(n) { this.x = n; } }
class Top { static make(o) { o.x = "text"; return 1; } }
function Base() {}
Object.setPrototypeOf(Base.prototype, Top.prototype);
Object.setPrototypeOf(Base, Top);
class A extends Base {}
function sum(o) { return o.x + 1; }
const o = new O(JSON.parse("1"));
console.log(A.make(o), sum(o), typeof o.x);
