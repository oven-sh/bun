function make() {
  class Cell { static count = 0; constructor() { Cell.count++; } }
  return Cell;
}
const First = make();
const Second = make();
new First(); new First(); new Second();
console.log(First === Second, First.count, Second.count, new First() instanceof Second, First.prototype === Second.prototype);
