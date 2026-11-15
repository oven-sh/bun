const say = value => (typeof value === "object" && value !== null ? JSON.stringify(value) : String(value));
const key = "tag";
const seen = [];
class Base { [key] = 7; }
class Loud extends Base { set [key](value) { seen.push(value); } }
function read(x) { x[key] = "new"; return x[key]; }
console.log(say(read(new Loud())), seen.length);
