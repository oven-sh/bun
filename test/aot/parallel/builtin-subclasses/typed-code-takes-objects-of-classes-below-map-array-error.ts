// An object of a class below Map or Error passes the test that typed code makes for its class: the methods of the class are called directly, and a function that
// takes such an object beside others runs its typed body. Nothing here looks a method up by name in the loops.
// COUNT: arrivals <= 40
class Defaults extends Map<string, number> {
  getOr(key: string, fallback: number): number {
    return this.get(key) ?? fallback;
  }
}
class Numbers extends Set<number> {
  twice(index: number): number {
    return index * 2;
  }
}
class Failure extends Error {}
class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}
function readDefault(defaults: Defaults, i: number): number {
  return defaults.getOr(i & 1 ? "a" : "b", 9);
}
function double(numbers: Numbers, i: number): number {
  return numbers.twice(i & 3);
}
function step(failure: Failure, point: Point, scale: number): number {
  return point.x * scale + point.y + (failure === lastFailure ? 1 : 2);
}
let lastFailure: Failure | undefined;
const defaults = new Defaults([["a", 1]]);
const numbers = new Numbers();
numbers.add(1).add(2);
const failure = new Failure("no");
const points = [new Point(1, 2), new Point(3, 4)];
lastFailure = failure;
let total = 0;
for (let i = 0; i < 2000; i++) total += readDefault(defaults, i) + double(numbers, i) + step(failure, points[i & 1]!, i & 7);
console.log(total);
