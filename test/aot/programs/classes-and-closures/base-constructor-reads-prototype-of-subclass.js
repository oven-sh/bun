function read(o) { return o.z; }
class Base { constructor() { this.seen = read(this); } }
class Sub extends Base { }
Sub.prototype.z = "proto";
console.log(new Sub().seen);
class Shape { constructor() { this.kind = this.describe(); this.sides = this.sideCount; this.label = this.tag; } }
class Square extends Shape { describe() { return "square"; } get sideCount() { return 4; } }
Square.prototype.tag = "sq";
const s = new Square();
console.log(s.kind, s.sides, s.label);
class Base2 { constructor() { this.n = this.defaultN; } }
class Sub2 extends Base2 { }
Sub2.prototype.defaultN = 7;
console.log(new Sub2().n);
