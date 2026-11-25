class Tagged {}
class Other extends Tagged { constructor(n) { super(); this.x = n; } }
Object.defineProperties(Tagged, { [Symbol.hasInstance]: { value: (v) => { v.x = "text"; return false; } } });
function sum(o) { return o.x + 1; }
const o = new Other(JSON.parse("1"));
console.log(o instanceof Other, sum(o), typeof o.x);
