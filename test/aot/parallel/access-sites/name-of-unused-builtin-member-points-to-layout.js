// `count` is also an accessor of a class of node:perf_hooks. This program never loads that module, so the name points to the one class of the program that has the field, and the loop reads a slot.
// COUNT: arrivals <= 100
let sink;
class Item {
  constructor(value) {
    this.flag = true;
    this.worth = value;
  }
}
class Payload {
  constructor() {
    this.issues = [1];
    this.count = 3;
  }
}
function sum(first, second, turns) {
  let total = 0;
  for (let i = 0; i < turns; i++) {
    first.worth = i & 7;
    total += second.count;
  }
  return total;
}
const hidden = process.env.NAMES_OF_THIS_TEST ?? "";
const functions = { sum };
const operands = { first: new Item(3), second: new Payload() };
sink = [functions, operands];
console.log(sink[0]["sum" + hidden](sink[1]["first" + hidden], sink[1]["second" + hidden], 20000), typeof sink);
