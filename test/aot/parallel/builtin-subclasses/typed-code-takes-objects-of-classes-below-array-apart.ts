// COUNT: operations <= 100 Todo: 4,023: an object of a class below a built-in class has no typed form yet: each of the 4,000 patterns is one call into the run time, which reads it by index
class Row extends Array<number> {
  firstTwo(): number {
    const [a, b] = this;
    return a! + b!;
  }
  lastOfThree(): number {
    const [, , c = 7] = this;
    return c;
  }
}
const row = new Row();
row.push(1, 2, 3);
const short = new Row();
short.push(4, 5);
let sum = 0;
for (let i = 0; i < 1000; i++) sum += row.firstTwo() + row.lastOfThree() + short.firstTwo() + short.lastOfThree();
console.log(sum);
