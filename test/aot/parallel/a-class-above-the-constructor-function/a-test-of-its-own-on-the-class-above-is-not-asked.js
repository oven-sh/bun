class O { constructor(n) { this.x = n; } }
class Top { static [Symbol.hasInstance](value) { value.x = "text"; return true; } }
function Base() {}
Object.setPrototypeOf(Base.prototype, Top.prototype);
class A extends Base {}
function sum(o) { return o.x + 1; }
const o = new O(JSON.parse("1"));
console.log(o instanceof A, sum(o), typeof o.x, o instanceof Top, sum(o), typeof o.x);
