// an object of one class on one side and of another class on the other comes to one call of a method, and the method of one class is replaced later
class Circle { constructor(public r: number) {} area() { return 3 * this.r * this.r; } }
class Square { constructor(public r: number) {} area() { return this.r * this.r; } }
function subject(round: unknown, r: number) { const s = round ? new Circle(r) : new Square(r); return s.area(); }
function deed(round: unknown, r: number) { return String(subject(round, r)); }
console.log(deed(true, 2), deed(false, 2), deed(0, 0.5), deed("x", -1));
let sum = 0;
for (let i = 0; i < 300; i++) sum += subject(i % 3, i % 7);
console.log(String(sum));
Circle.prototype.area = function () { return -this.r; };
console.log(deed(JSON.parse("1"), 5), deed(JSON.parse("0"), 5));
