const zero = 0;
let sum = 0, told = "";
try { for (let i = 0; i < 3; i++) sum += new Point(i, 2).sum(); } catch (error) { told = error.name; }
for (let i = 0; i < 0; i++) sum += new Point(i, 2).sum();
class Origin { constructor() { this.o = 0; } }
class Point extends Origin { constructor(x, y) { super(); this.x = x; this.y = y; } sum() { return this.x + this.y + this.o; } }
for (let i = 0; i < 3; i++) sum += new Point(i, 2).sum();
console.log(told, sum);
