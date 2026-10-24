import { Circle, Shape } from "./family";

export class Ring extends Circle {
  area(): number {
    return super.area() - 1;
  }
}

Shape.prototype.area = function () {
  return this.side + 100;
};
