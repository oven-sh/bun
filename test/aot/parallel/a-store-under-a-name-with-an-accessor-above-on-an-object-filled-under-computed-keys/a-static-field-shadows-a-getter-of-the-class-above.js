const say = value => (typeof value === "object" && value !== null ? JSON.stringify(value) : String(value));
const key = ["t", "a", "g"].join("");
class Base { static get tag() { return { v: 1 }; } }
class Loud extends Base { static [key] = 7; }
function read(x) { x.tag = "new"; return x.tag; }
console.log(say(read(Loud)));
