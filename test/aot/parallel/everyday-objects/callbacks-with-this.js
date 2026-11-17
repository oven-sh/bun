// Callbacks with a receiver for forEach, map and filter, and without one
class Filter {
  constructor(limit) {
    this.limit = limit;
    this.seen = 0;
  }
  keep(n) {
    this.seen++;
    return n > this.limit;
  }
  run(list) {
    const a = list.filter(this.keep, this);
    const b = list.filter(n => this.keep(n));
    const c = list.map(function (n) { return n * this.limit; }, this);
    let sum = 0;
    list.forEach(function (n, i) { this.seen += i; sum += n; }, this);
    return [a.join("+"), b.length, c.join("+"), sum, this.seen].join();
  }
}
console.log(new Filter(2).run([1, 2, 3]));
console.log(new Filter(10).run([5, 15, 25, 35]));
console.log(new Filter(0).run([]));
