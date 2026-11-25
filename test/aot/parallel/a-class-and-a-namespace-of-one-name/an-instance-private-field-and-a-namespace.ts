class Point {
  #x: number;
  constructor(x: number) { this.#x = x; }
  get x() { return this.#x; }
}
namespace Point {
  export const origin = new Point(0);
}
console.log(Point.origin.x, new Point(Number(process.argv[2] ?? 3)).x);
export {};
