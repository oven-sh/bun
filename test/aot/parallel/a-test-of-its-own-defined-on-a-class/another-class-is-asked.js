class Other { constructor(n) { this.x = n; } }
class Third { constructor(n) { this.y = n; } }
class Tagged {}
Object.defineProperty(Tagged, Symbol.hasInstance, { value: (v) => { v.x = "text"; v.y = "text"; return true; } });
function sum(o, t) { return o.x + t.y; }
const o = new Other(JSON.parse("1")), t = new Third(JSON.parse("2"));
console.log(o instanceof Other, t instanceof Other, t instanceof Third, sum(o, t));
