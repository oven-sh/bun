class Other { constructor(n) { this.x = n; } }
class Third { constructor(n) { this.y = n; } }
const tester = { [Symbol.hasInstance](v) { v.x = "text"; return true; } };
function sum(o, t) { return o.x + t.y; }
const o = new Other(JSON.parse("1")), t = new Third(JSON.parse("2"));
console.log(t instanceof Third, o instanceof Other, sum(o, t), o instanceof tester, sum(o, t));
