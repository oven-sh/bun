class Box { constructor() { this.n = 1; } toJSON() { this.n = "text"; return 0; } }
function next(box) { return box.n + 1; }
const held = new Box();
console.log(next(held));
console.log(JSON.stringify([held]));
console.log(next(held));
