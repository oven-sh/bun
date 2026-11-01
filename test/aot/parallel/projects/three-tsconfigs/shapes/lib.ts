export class Shape {
  name: string;
  sides?: number;
  constructor(name: string, sides?: number) {
    this.name = name;
    if (sides !== undefined) this.sides = sides;
  }
  describe(): string {
    return this.name + ":" + ("sides" in this ? this.sides : "none");
  }
}
export function area(size: { width: number; height?: number }): number {
  return size.width * (size.height ?? size.width);
}
export function count(shapes: Shape[]): number {
  let sides = 0;
  for (const shape of shapes) sides += shape.sides ?? 0;
  return sides;
}
