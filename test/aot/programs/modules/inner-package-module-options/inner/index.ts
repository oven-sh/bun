import { Shape } from "./shape.ts";
export function area(shape: Shape): number {
  return shape.width * shape.height;
}
