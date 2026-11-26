// What a built-in calls takes other arguments than the built-in, and hands back other results.
class Point {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }
}

let held;
function move() {
  held.x = 40;
  held.y = 2;
}

function sum(point) {
  let total = 0;
  for (let turn = 0; turn < 2; turn++) {
    for (let side = 0; side < 2; side++) {
      if (turn === 1 && side === 0) move();
      total += point.x * 100 + point.y;
    }
  }
  return total;
}

function join(left, right) {
  return new Point(left.x + right.x, left.y + right.y);
}

function pick(list) {
  const point = list.reduce(join);
  return sum(point);
}

const point = new Point(1, 2);
held = point;
console.log(sum.call(new Point(8, 9), point));
held = point;
point.x = 1;
console.log(Reflect.apply(sum, new Point(8, 9), [point]));
point.x = 3;
console.log(sum.apply(new Point(8, 9), [point]));
point.x = 5;
console.log(sum.bind(new Point(8, 9), point)());
const only = new Point(6, 7);
held = only;
console.log(pick([only]));
held = new Point(0, 0);
console.log(pick([new Point(1, 1), new Point(2, 2)]), held.x);
const both = new Point(3, 4);
held = both;
console.log([both].map(sum)[0], both.x);
console.log(Array.from([new Point(1, 2)], sum)[0]);
