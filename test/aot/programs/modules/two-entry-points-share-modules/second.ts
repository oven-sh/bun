import { log } from "./first";
import { describe, type Shape } from "./shapes";
export const name = "second";
export function area(shape: Shape): number {
  log("area of", describe(shape));
  return shape.kind === "square" ? shape.side * shape.side : Math.PI * shape.radius * shape.radius;
}
log("second is evaluated");
