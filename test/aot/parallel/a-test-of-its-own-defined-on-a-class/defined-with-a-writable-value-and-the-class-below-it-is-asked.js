class Tagged {}
class Other extends Tagged { constructor(n) { super(); this.x = n; } }
function spoil(v) { v.x = "text"; return false; }
Object.defineProperty(Tagged, Symbol.hasInstance, { value: spoil, writable: true });
function sum(o) { return o.x + 1; }
const o = new Other(JSON.parse("1"));
console.log(o instanceof Other, sum(o), typeof o.x);
