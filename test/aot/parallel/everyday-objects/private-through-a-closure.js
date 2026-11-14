// Private fields read through functions that are made inside the class
class Counter {
  #n = 0;
  step = by => (this.#n += by);
  reader() {
    return () => this.#n;
  }
}
function count(steps) {
  const a = new Counter();
  const b = new Counter();
  const read = a.reader();
  const step = a.step;
  for (const by of steps) {
    step(by);
    b.step(by * 2);
  }
  return read() + " " + b.reader()() + " " + Object.keys(a).join();
}
console.log(count([1, 2, 3]));
console.log(count([10]));
console.log(count([]));
