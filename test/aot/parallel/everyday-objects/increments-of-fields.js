// Increments of fields in conditions, in arguments and of accessors
class Counter {
  constructor(n) {
    this.n = n;
    this.reads = 0;
  }
  get value() {
    this.reads++;
    return this.n;
  }
  set value(n) {
    this.n = n;
  }
}
function count(n, limit) {
  const c = new Counter(n);
  const list = [];
  while (c.value++ < limit) list.push(c.n--, c.n++);
  list.push(Math.max(++c.value, c.value++, c.n));
  return list.join() + " " + c.n + " " + c.reads;
}
console.log(count(0, 2));
console.log(count(5, 8));
console.log(count(9, 1));
