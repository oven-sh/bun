const say = value => (typeof value === "object" && value !== null ? JSON.stringify(value) : String(value));
const key = "tag";
class Base { [key] = 7; }
class Loud extends Base { get [key]() { return { v: 1 }; } }
function read(x) { x[key] = "new"; return x[key]; }
console.log(say(read(new Loud())));
