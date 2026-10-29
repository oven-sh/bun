import * as all from "./index";

console.log("shapes/square");

export class Square extends all.Shape {
  constructor(readonly side: number) {
    super();
  }
  area() {
    return this.side * this.side;
  }
}
