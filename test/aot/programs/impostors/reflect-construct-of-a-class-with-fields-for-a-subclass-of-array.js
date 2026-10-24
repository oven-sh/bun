class Point {
  x = 1;
  y = 2;
}
class List extends Array {}

const p = Reflect.construct(Point, [], List);
console.log("keys", Object.keys(p).join());
console.log("x", p.x);
console.log("y", p.y);
console.log("sum", p.x + p.y);
console.log("is an array", Array.isArray(p));
console.log("prototype is that of List", Object.getPrototypeOf(p) === List.prototype);
