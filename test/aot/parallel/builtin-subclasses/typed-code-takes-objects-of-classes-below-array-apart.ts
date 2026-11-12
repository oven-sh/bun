// COUNT: operations <= 100 Todo: an element behind the end of an object of a class below Array is read by the run time: 1,000 calls of operationAOTGetByVal.
// COUNT: operations <= 1040
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
