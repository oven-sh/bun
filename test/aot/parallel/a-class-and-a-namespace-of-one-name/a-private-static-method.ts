class Shape {
  static #area(width: number) { return width * width; }
  static of(width: number) { return Shape.#area(width); }
}
namespace Shape {
  export const unit = Shape.of(1);
  export function twice(width: number) { return Shape.of(width) * 2; }
}
console.log(Shape.unit, Shape.twice(Number(process.argv[2] ?? 3)));
export {};
