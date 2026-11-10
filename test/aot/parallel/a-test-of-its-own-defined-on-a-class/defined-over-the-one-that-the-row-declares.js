class Other { constructor(n) { this.x = n; } }
class Base { static [Symbol.hasInstance](v) { return false; } }
class Tagged extends Base {}
class Lowest extends Tagged {}
Object.defineProperty(Tagged, Symbol.hasInstance, { value: (v) => { v.x = "text"; return true; } });
function sum(o) { return o.x + 1; }
const first = new Other(JSON.parse("1")), second = new Other(JSON.parse("1")), third = new Other(JSON.parse("1")), fourth = new Other(JSON.parse("1"));
console.log(first instanceof Other, sum(first), second instanceof Base, sum(second), third instanceof Tagged, sum(third), fourth instanceof Lowest, sum(fourth));
