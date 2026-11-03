// COUNT: arrivals <= 40
class Numbers extends Array<number> {
  byIndex(): number {
    let total = 0;
    for (let i = 0; i < this.length; i++) total += this[i]!;
    return total;
  }
  byWalk(): number {
    let total = 0;
    for (const value of this) total += value;
    return total;
  }
}
class Names extends Array<string> {
  lengths(): number {
    let total = 0;
    for (const name of this) total += name.length;
    return total;
  }
}
function turn(numbers: Numbers, names: Names, i: number): number {
  return numbers.byIndex() + numbers.byWalk() + names.lengths() + (i & 1);
}
const numbers = Numbers.from([1, 2, 3, 4]) as Numbers;
const names = new Names();
names.push("a", "bc", "def");
let sum = 0;
for (let i = 0; i < 1000; i++) sum += turn(numbers, names, i);
console.log(sum);
