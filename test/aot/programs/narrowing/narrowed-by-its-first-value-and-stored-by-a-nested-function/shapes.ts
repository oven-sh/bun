export interface Shape {
  area(): number;
}
class Named {
  describe() {
    return this.constructor.name;
  }
}
export class Circle extends Named implements Shape {
  constructor(public r: number) {
    super();
  }
  area() {
    return 3 * this.r * this.r;
  }
}
export class Square extends Named implements Shape {
  constructor(public side: number) {
    super();
  }
  area() {
    return this.side * this.side;
  }
}
