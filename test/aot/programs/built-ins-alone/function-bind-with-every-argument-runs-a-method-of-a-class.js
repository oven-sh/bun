class Counter {
  count = 1.5;
  add(first, second) {
    return this.count + second;
  }
}
console.log(Counter.prototype.add.bind(new Counter(), 1, 2.5)());
