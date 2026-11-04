// an object of one class on one side and of another class on the other comes to one call of a method, and an accessor is laid over the method of one class later
class Circle { constructor(public r: number) {} area(): unknown { return 3 * this.r * this.r; } }
class Square { constructor(public r: number) {} area(): unknown { return this.r * this.r; } }
let gets = 0;
function subject(round: unknown, r: number) { const s = round ? new Circle(r) : new Square(r); return s.area(); }
function deed(round: unknown, r: number) { return String(subject(round, r)) + String(gets); }
console.log(deed(true, 2), deed(false, 2), deed(0, 0.5), deed("x", -1));
let out = 0;
for (let i = 0; i < 300; i++) out += String(subject(i % 3, i % 7)).length;
console.log(String(out));
Object.defineProperty(Square.prototype, "area", { get() { gets++; return () => "got"; } });
console.log(deed(JSON.parse("1"), 6), deed(JSON.parse("0"), 6));
