// Species: programs y prototype compared. It prints what plain Bun prints.
class Point { x = 1; }
const held: any[] = JSON.parse("[]");
held.push(new Point());
console.log(Object.getPrototypeOf(held[0]) === Point.prototype, held[0].__proto__ === Point.prototype, Point.prototype.isPrototypeOf(held[0]));
