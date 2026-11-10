class Vector {
  constructor(
    public x: number,
    public y: number,
  ) {}
  plus(other: Vector): Vector {
    return new Vector(this.x + other.x, this.y + other.y);
  }
  times(by: number): Vector {
    return new Vector(this.x * by, this.y * by);
  }
  get length(): number {
    return Math.hypot(this.x, this.y);
  }
}
let sum = new Vector(0, 0);
for (let i = 1; i <= 3; i++) sum = sum.plus(new Vector(i, i * 2).times(0.5));
console.log(sum.x, sum.y, sum.length.toFixed(3));
