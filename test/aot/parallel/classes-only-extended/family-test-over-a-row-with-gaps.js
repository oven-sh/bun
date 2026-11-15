class Shape { area() { return 0; } }
class Sided extends Shape { constructor(n) { super(); this.n = n; } area() { return this.n; } }
class Square extends Sided { constructor(s) { super(4); this.s = s; } area() { return this.s * this.s; } }
class Triangle extends Sided { constructor(b, h) { super(3); this.b = b; this.h = h; } area() { return this.b * this.h / 2; } }
function total(list) { let sum = 0; for (const each of list) sum += each.area() + (each instanceof Sided ? each.n : 100); return sum; }
console.log(total([new Square(2), new Triangle(3, 4), new Shape()]));
console.log(total([new Square(2), new (Object.getPrototypeOf(Square))(7)]));
