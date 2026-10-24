import { log } from "./first";
export type Shape = { kind: "square"; side: number } | { kind: "circle"; radius: number };
export function describe(shape: Shape): string {
  return shape.kind === "square" ? "a square of " + shape.side : "a circle of " + shape.radius;
}
log("shapes is evaluated");
