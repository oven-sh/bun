interface Members {
  run(this: Point): number;
  limit: number;
  constructor: PointMaker;
}
interface Point extends Members {
  x: number;
}
interface PointMaker {
  new (x: number): Point;
  (this: Point, x: number): void;
  prototype: Members;
}
const Point = function (this: Point, x: number) {
  this.x = x;
} as PointMaker;
Point.prototype = {
  run() {
    return this.x + this.limit;
  },
  limit: 2,
  constructor: Point,
};

function readMembers(members: Members): string {
  return members.limit + " " + typeof members.run + " " + (members.constructor === Point);
}
function use(point: Point): number {
  return point.run() + point.limit;
}
function hot(): number {
  let sum = 0;
  for (let i = 0; i < 3000; i++) sum += use(new Point(i & 7));
  return sum;
}
console.log(hot(), readMembers(Point.prototype), readMembers(new Point(1)), readMembers({ run: () => 1, limit: 9, constructor: Point }));
Point.prototype.limit = 3;
console.log(hot(), readMembers(Point.prototype));
Point.prototype.run = function () {
  return -1;
};
console.log(hot(), Object.keys(Point.prototype).join());
const own = new Point(1);
own.limit = 100;
console.log(use(own), Object.keys(own).join());
