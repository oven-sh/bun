// COUNT: arrivals <= 40
class Numbers extends Array<number> {
  twice(index: number): number {
    return index * 2;
  }
  size(): number {
    return this.length;
  }
}
class Evens extends Numbers {
  twice(index: number): number {
    return index * 4;
  }
}
function turn(numbers: Numbers, i: number): number {
  return numbers.twice(i) + numbers.size();
}
const numbers = new Numbers();
numbers.push(1, 2, 3, 4);
const evens = Evens.from([2, 4]) as Evens;
let sum = 0;
for (let i = 0; i < 1000; i++) sum += turn(numbers, i) + turn(evens, i);
console.log(sum);
