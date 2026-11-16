const say = value => (typeof value === "object" && value !== null ? JSON.stringify(value) : String(value));
function read(x) { x.tag = "new"; return x.tag; }
function make() {
  const key = ["t", "a", "g"].join("");
  class Base { [key] = 7; }
  class Loud extends Base { get tag() { return { v: 1 }; } }
  return new Loud();
}
console.log(say(read(make())));
