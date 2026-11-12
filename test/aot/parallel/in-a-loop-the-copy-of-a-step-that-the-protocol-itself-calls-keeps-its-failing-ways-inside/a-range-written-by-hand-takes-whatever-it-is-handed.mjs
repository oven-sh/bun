// The bounds are numbers as a rule; the guesses inside the copy of next() fail on all else, and those ways run in the copy.
class Range {
  constructor(from, to) { this.from = from; this.to = to; }
  [Symbol.iterator]() {
    let at = this.from;
    const to = this.to;
    return { next() { return at < to ? { value: at++, done: false } : { value: undefined, done: true }; } };
  }
}
let asked = 0;
const counting = { valueOf() { asked++; return 2; } };
const bounds = [[0, 4], [3, 3], ["2", 5], [1n, 4n], [undefined, 3], [null, 2], [1.5, 4], [counting, 4], [0, "3"], [-0, 1], [true, 3], ["a", "c"], [0, NaN]];
function sum(from, to) {
  let said = "";
  for (const i of new Range(from, to)) said += typeof i + ":" + String(i) + " ";
  return said;
}
const out = [];
for (let turn = 0; turn < 60; turn++) {
  const [from, to] = bounds[turn % 7 === 6 ? turn % bounds.length : 0];
  out.push(sum(from, to));
}
for (const [from, to] of bounds) out.push(sum(from, to));
console.log([...new Set(out)].join("|"), out.length, asked);
