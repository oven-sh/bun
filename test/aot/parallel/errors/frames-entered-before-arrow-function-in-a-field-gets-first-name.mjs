// Todo: row 3558: the calls `holder.handle(..)` of the object whose arrow function gets the name print `handle`: they enter the function without its function object, which is made when the field is read
// An arrow function in a field of a class is made for every object. One of them leaves sight and gets a name behind the stacks. The others keep the name that is written.
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
const holders = [new Holder("a"), new Holder("b"), new Holder("c")];
for (const holder of holders)
  holder.handle(1);
const left = handedBack(holders[1].handle);
holders[1].handle(2);
left(3);
holders[2].handle(4);
give(left, "left");
console.log(kept.map(error => names(error, 1)).join(" . "));
