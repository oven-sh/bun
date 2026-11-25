class Other { constructor(n) { this.x = n; } }
class Tagged {}
let said;
try {
    Object.assign(Tagged, { [Symbol.hasInstance]: (v) => { v.x = "text"; return true; } });
    said = "laid";
} catch (error) {
    said = error.constructor.name;
}
function sum(o) { return o.x + 1; }
const o = new Other(JSON.parse("1"));
console.log(said, o instanceof Tagged, o instanceof Other, sum(o), typeof o.x);
