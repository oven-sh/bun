const say = value => (typeof value === "object" && value !== null ? JSON.stringify(value) : String(value));
const seen = [];
class Base { other = 7; }
class Loud extends Base { get tag() { return { v: 1 }; } set tag(value) { seen.push(value); } }
function read(x) { x.tag = "new"; return x.tag; }
console.log(say(read(new Loud())), seen.join());
