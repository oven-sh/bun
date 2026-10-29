import { Shape, area } from "../shapes/lib.ts";
import { keep } from "../scripts/lib.ts";
export class Named extends Shape {
  constructor() {
    super("named", 3);
  }
  describe(): string {
    return "named " + super.describe();
  }
}
function add(a: number, b: number): number {
  return a + b;
}
export function callLoosely(): unknown {
  return [add.call(undefined, "1", 2), add.apply(undefined, [1]), add.bind(undefined, "a")("b")];
}
export function withoutSides(): Shape {
  const shape = new Shape("loose", 4);
  shape.sides = undefined;
  return shape;
}
export function areaOfNothing(): number {
  return area({ width: 2, height: undefined });
}
export const keptShape: Shape = keep(new Named());
