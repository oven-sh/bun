// No class and no literal of this program has a `value`. The library has records with one, the results of its iterators among them, and `value` is also an accessor of WebAssembly.Global.
// The object that is asked for its `value` is none of those. A test for the library's records would turn it away in every turn, and the reads of the payload behind the test would go by name with it:
// four names looked up a turn. Without a test it is one.
// COUNT: arrivals <= 21000
let sink;
class Payload {
  constructor() {
    this.issues = [1];
    this.count = 3;
  }
}
function stranger(worth) {
  const object = Object.create({ kind: "stranger" });
  for (const name of names) object[name] = worth;
  return object;
}
const names = (process.env.NAMES_OF_THIS_TEST ?? "value,next").split(",");
function sum(first, second, turns) {
  let total = 0;
  for (let i = 0; i < turns; i++) total += first.value + second.issues.length + second.count;
  return total;
}
const hidden = process.env.NAMES_OF_THIS_TEST ?? "";
const functions = { sum };
const operands = { first: stranger(3), second: new Payload() };
sink = [functions, operands];
console.log(sink[0]["sum" + hidden](sink[1]["first" + hidden], sink[1]["second" + hidden], 20000), typeof sink);
