class Counter {
  count = 1.5;
  add(first, second) {
    return this.count + second;
  }
}
console.log(Reflect.apply(Counter.prototype.add, new Counter(), [1, 2.5]));
