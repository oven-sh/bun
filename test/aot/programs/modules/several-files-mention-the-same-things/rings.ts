import { Circle, Shape } from "./shapes";
import type { Tagged } from "./tags";

let made = 0;

export class Ring extends Circle {
  override readonly kind: string = "ring";
  constructor(
    radius: number,
    public hole: number,
  ) {
    super(radius);
    made++;
  }
  override area(): number {
    return super.area() - Math.PI * this.hole * this.hole;
  }
  tagged(): Tagged {
    return { tag: this.kind, weight: this.radius - this.hole };
  }
}

export function shrink(shape: Ring | null | Shape): Shape {
  if (shape instanceof Ring) return new Ring(shape.radius - 1, shape.hole - 1);
  return shape ?? new Circle(0);
}

export function ringsMade(): number {
  return made;
}
