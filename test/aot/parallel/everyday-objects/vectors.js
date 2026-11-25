// A class of vectors with methods that make new ones, in loops
class Vector {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }
  plus(other) {
    return new Vector(this.x + other.x, this.y + other.y);
  }
  times(n) {
    return new Vector(this.x * n, this.y * n);
  }
  get length() {
    return Math.abs(this.x) + Math.abs(this.y);
  }
}
function walk(x, y, steps) {
  let at = new Vector(0, 0);
  let step = new Vector(x, y);
  const path = [];
  for (let i = 0; i < steps; i++) {
    at = at.plus(step);
    step = new Vector(-step.y, step.x).times(i % 2 ? 1 : 2);
    path.push(at.x + ":" + at.y);
  }
  return path.join(" ") + " " + at.length;
}
console.log(walk(1, 0, 5));
console.log(walk(3, -2, 4));
console.log(walk(0, 0, 2));
