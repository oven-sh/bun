class O { constructor(n) { this.x = n; } }
class Tagged {}
class Other extends Tagged {}
Object.defineProperty(Tagged, "make", { value: (v) => { v.x = "text"; return 1; } });
function sum(o) { return o.x + 1; }
const o = new O(JSON.parse("1"));
console.log(Other.make(o), sum(o), typeof o.x);
