const tool = require("./tool.cjs");
class Bench {
  work(most) {
    let total = 0;
    for (let turn = 0; turn < most; turn++) total = total * 3 + ((turn * 7 + 3) % tool.held);
    return total;
  }
}
const bench = new Bench();
console.log("SAID " + bench.work(Number("0")) + " " + bench.work(Number("3")));
