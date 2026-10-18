// reads a getter of the same name from objects of four classes at one place
const operations = 100;
class Circle {
  r: number;
  constructor(r: number) {
    this.r = r;
  }
  get area(): number {
    return this.r * this.r * 3;
  }
}
class Square {
  side: number;
  constructor(side: number) {
    this.side = side;
  }
  get area(): number {
    return this.side * this.side;
  }
}
class Strip {
  width: number;
  length: number;
  constructor(width: number, length: number) {
    this.width = width;
    this.length = length;
  }
  get area(): number {
    return this.width * this.length;
  }
}
class LargeSquare extends Square {
  get area(): number {
    return this.side * this.side * 4;
  }
}
function shapes(): any[] {
  return [new Circle(2), new Square(3), new Strip(4, 5), new LargeSquare(6)];
}
const all = shapes();
let total = 0;

kernel: {
  let sum = 0;
  for (let i = 0; i < operations; i++) sum += all[i & 3].area;
  total += sum;
}

console.log(total);
