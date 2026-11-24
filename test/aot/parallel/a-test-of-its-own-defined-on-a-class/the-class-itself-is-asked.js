class Other { constructor(n) { this.x = n; } }
class Tagged {}
Object.defineProperty(Tagged, Symbol.hasInstance, { value: (v) => { v.x = "text"; return true; } });
function sum(o) { return o.x + 1; }
const o = new Other(JSON.parse("1"));
console.log(o instanceof Tagged, sum(o), typeof o.x);
