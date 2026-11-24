const say = value => (typeof value === "object" && value !== null ? JSON.stringify(value) : String(value));
const place = [3].length + 2;
class Base { [place] = 7; }
class Loud extends Base { get 3() { return { v: 1 }; } }
function read(x) { x[3] = "new"; return x[3]; }
console.log(say(read(new Loud())));
