// a loop calls a method, allocates an object of another class whose constructor replaces that method in one turn, and calls the method again
class Shape { constructor() { this.side = 2; } area() { return this.side * this.side; } }
const original = Shape.prototype.area;
let countdown = -1;
class Point { constructor() { this.x = 1; if (countdown-- === 0) Shape.prototype.area = function () { return 1; }; } }
const moved = new Shape();
Object.setPrototypeOf(moved, { area() { return 0; } });
function subject(shape, n) { let total = 0; let last = null; for (let i = 0; i < n; i++) { total += shape.area(); last = new Point(); total += shape.area(); } return total + last.x; }
function deed() { countdown = 1; const answer = subject(new Shape(), 3); Shape.prototype.area = original; return answer; }
console.log(String(subject(new Shape(), 3)) + "," + String(subject(moved, 3)));
console.log(String(deed()));
let total = 0;
for (let i = 0; i < 300; i++) total += deed();
console.log(String(total));
console.log(String(subject(new Shape(), 3)));
