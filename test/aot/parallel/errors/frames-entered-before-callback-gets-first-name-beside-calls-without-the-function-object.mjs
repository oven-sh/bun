// An arrow function in a field of a class is made for every object. One of them leaves sight, is called by value and gets a name behind the stacks. A call of another object's, from the same place, keeps the name that is written.
const never = process.argv.length > 1000 ? "x" : "";
const handedBack = new Function("f", "return f;" + never);
const give = new Function("f", "name", "f.displayName = name;" + never);
const names = (error, count = 3) =>
  error.stack
    .split("\n")
    .slice(1, 1 + count)
    .map(line => line.trim().replace(/^at /, "").replace(/ ?\(.*\)$/, ""))
    .join(" < ");
const kept = [];
class Holder {
  constructor(label) {
    this.label = label;
  }
  handle = value => {
    kept.push(new Error(this.label + value));
  };
}
const holders = [new Holder("a"), new Holder("b")];
const left = handedBack(holders[0].handle);
left(1);
holders[1].handle(2);
left(3);
holders[1].handle(4);
give(left, "left");
console.log(kept.map(error => names(error, 1)).join(" . "));
