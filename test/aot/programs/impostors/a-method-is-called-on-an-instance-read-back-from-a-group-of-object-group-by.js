class Counter {
  count = 0;
  add() {
    this.count += 0.5;
  }
}
const counter = new Counter();
Object.groupBy([counter], () => "group").group[0].add();
console.log("count", counter.count);
