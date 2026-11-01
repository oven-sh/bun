import * as all from "./index";

console.log("shapes/shape");

export class Shape {
  static count = 0;
  constructor() {
    Shape.count++;
  }
  static unit() {
    return new all.Square(1);
  }
}
