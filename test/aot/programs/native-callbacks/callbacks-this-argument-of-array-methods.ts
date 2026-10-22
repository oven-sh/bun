// Callbacks handed over: forEach, map and Array.from call a method that was taken off its object with the `this` they were given, a string, another object or undefined; direct calls go through an instance.
let total = 0;

class Tally {
  count = 1;
  add(value: number): number {
    total += this === undefined ? 100 : this instanceof Tally ? this.count : typeof this === "string" ? 10000 : 1000000;
    return this === undefined ? -1 : (this.count ?? 50) + value;
  }
}

const tally = new Tally();
tally.add(1);
const results = [
  [1].map(tally.add),
  [1].map(tally.add, tally),
  [1].map(tally.add, "text"),
  [1].map(tally.add, { count: "7" }),
  [1].map(tally.add, 5),
  Array.from([1], tally.add, { count: 9 }),
  [new Set([1]).forEach(tally.add, undefined)],
  [new Map([[1, 2]]).forEach(tally.add, tally)],
];
console.log(total, results.join());
