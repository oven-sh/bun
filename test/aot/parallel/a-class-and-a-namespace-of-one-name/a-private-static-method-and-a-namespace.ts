class Shape {
  static #area(width: number) { return width * width; }
  static of(width: number) { return Shape.#area(width); }
}
namespace Shape {
  export const unit = Shape.of(1);
}
console.log(Shape.unit, Shape.of(Number(process.argv[2] ?? 3)));
export {};
