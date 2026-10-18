import { Shape } from "./shape.js";

class Box extends Shape {
  width = 3;
  height = 4;
  area(): number {
    return this.width * this.height;
  }
}

console.log(new Box().area());
