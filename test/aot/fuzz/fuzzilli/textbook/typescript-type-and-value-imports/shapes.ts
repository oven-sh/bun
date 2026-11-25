export enum Kind {
  Square,
  Circle,
}
export interface Shape {
  kind: Kind;
  size: number;
}
export function area(shape: Shape): number {
  return shape.kind === Kind.Square ? shape.size * shape.size : Math.PI * shape.size * shape.size;
}
