const say = value => (typeof value === "object" && value !== null ? JSON.stringify(value) : String(value));
const key = ["t", "a", "g"].join("");
class Base { [key] = 7; }
class Loud extends Base { get tag() { return 1; } }
function read(x) { x.tag = { deep: [1, 2] }; return x.tag; }
const got = read(new Loud());
console.log(say(got), typeof got === "object" ? got.deep.length : "none");
