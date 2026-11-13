// Private fields and methods of the class stay behind; functions held in fields are the same functions in the copy.
class Counter {
  #hidden = 41;
  shown = 1;
  run = () => this.#hidden + 1;
  static has(value: object) {
    return #hidden in value;
  }
  peek() {
    return this.#hidden;
  }
}
const helpers = { alpha: 1, twice(value: number) { return value * 2; }, arrow: (value: number) => value + 1 };
for (let round = 0; round < 5; round++) {
  const source = new Counter();
  const made = Object.assign(Object.create(Counter.prototype), source) as Counter;
  let peeked: string;
  try {
    peeked = String(made.peek());
  } catch (error) {
    peeked = (error as Error).name;
  }
  console.log(round, Object.keys(made).join(), Counter.has(made), Counter.has(source), made.run === source.run, made.run(), peeked);
  const copied = Object.assign(Object.create(null), helpers);
  console.log(round, copied.twice === helpers.twice, copied.arrow === helpers.arrow, copied.twice(4), copied.arrow(4), Object.keys(copied).join());
}
