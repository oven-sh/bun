class Other { constructor(n) { this.x = n; } }
async function waits() {}
function* yields() {}
Object.defineProperty(waits, Symbol.hasInstance, { value: (v) => { v.x = "text"; return true; } });
Object.defineProperty(yields, Symbol.hasInstance, { value: (v) => { v.x = "text"; return true; } });
function sum(o) { return o.x + 1; }
const first = new Other(JSON.parse("1")), second = new Other(JSON.parse("1")), third = new Other(JSON.parse("1"));
console.log(first instanceof Other, sum(first), second instanceof waits, sum(second), third instanceof yields, sum(third));
