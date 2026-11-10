class Tagged {}
class Other extends Tagged { constructor(n) { super(); this.x = n; } }
class Lowest extends Other {}
Object.defineProperty(Tagged, Symbol.hasInstance, { value: (v) => { v.x = "text"; return false; } });
function sum(o) { return o.x + 1; }
const first = new Other(JSON.parse("1")), second = new Other(JSON.parse("1"));
console.log(first instanceof Other, sum(first), typeof first.x, second instanceof Lowest, sum(second), typeof second.x);
