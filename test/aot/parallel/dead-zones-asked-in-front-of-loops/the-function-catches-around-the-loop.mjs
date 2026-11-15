const zero = 0;
function run(n) { let sum = 0; try { for (let i = 0; i < n; i++) sum += new Point(i, 2).sum(); } catch (error) { return error.name.length; } return sum; }
function attempt(n) { try { return String(run(n)); } catch (error) { return error.name; } }
console.log(attempt(0), attempt(3));
class Origin { constructor() { this.o = 0; } }
class Point extends Origin { constructor(x, y) { super(); this.x = x; this.y = y; } sum() { return this.x + this.y + this.o; } }
console.log(attempt(0), attempt(3));
