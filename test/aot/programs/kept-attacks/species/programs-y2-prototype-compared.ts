// Species: programs  prototype compared. It prints what plain Bun prints.
const log: string[] = [];
class Point { x = 1; }
const held: any[] = JSON.parse("[]");
held.push(new Point());
log.push(String(Object.getPrototypeOf(held[0]) === Point.prototype), String(held[0].__proto__ === Point.prototype), String(held[0].constructor === Point));
console.log(log.join("; "));
