class O { constructor(n) { this.x = n; } }
class Tagged {}
function Below() {}
Object.setPrototypeOf(Below, Tagged);
Object.defineProperty(Tagged, Symbol.hasInstance, { value: (v) => { v.x = "text"; return false; } });
function sum(o) { return o.x + 1; }
const o = new O(JSON.parse("1"));
console.log(o instanceof Below, sum(o), typeof o.x);
